// This deliberately accepts a conservative subset of the core WASM ABI.
// Call only after full WABT validation. Unsupported future ABI forms fail closed.
const VALUE_TYPES = new Map([
    [0x7f, 'i32'], [0x7e, 'i64'], [0x7d, 'f32'], [0x7c, 'f64'],
    [0x7b, 'v128'], [0x70, 'funcref'], [0x6f, 'externref'],
]);
const KIND_NAMES = ['function', 'table', 'memory', 'global'];

class Reader {
    constructor(bytes) { this.bytes = bytes; this.position = 0; }
    byte() {
        if (this.position >= this.bytes.length) throw new Error('Truncated WASM ABI');
        return this.bytes[this.position++];
    }
    take(length) {
        const end = this.position + length;
        if (end > this.bytes.length) throw new Error('Truncated WASM ABI payload');
        const value = this.bytes.subarray(this.position, end);
        this.position = end;
        return value;
    }
    u32() {
        let value = 0;
        for (let i = 0; i < 5; i++) {
            const byte = this.byte();
            value += (byte & 0x7f) * 2 ** (7 * i);
            if (!(byte & 0x80)) {
                if (value > 0xffffffff) throw new Error('WASM ABI integer overflow');
                return value;
            }
        }
        throw new Error('Oversized WASM ABI integer');
    }
    name() { return new TextDecoder('utf-8', { fatal: true }).decode(this.take(this.u32())); }
    vector(read) { return Array.from({ length: this.u32() }, () => read(this)); }
    done() {
        if (this.position !== this.bytes.length) throw new Error('Unparsed WASM ABI data');
    }
}

function valueType(reader) {
    const code = reader.byte();
    const type = VALUE_TYPES.get(code);
    if (!type) throw new Error(`Unsupported WASM ABI value type: 0x${code.toString(16)}`);
    return type;
}
function limits(reader, memory = false) {
    const flags = reader.u32();
    // memory64, table64, custom page sizes, etc. require an explicit parser review.
    if (flags > (memory ? 3 : 1)) throw new Error('Unsupported WASM ABI limits flags');
    return { min: reader.u32(), max: flags & 1 ? reader.u32() : null, shared: Boolean(flags & 2) };
}
function tableType(reader) { return { element: valueType(reader), ...limits(reader) }; }
function globalType(reader) {
    const value = valueType(reader), mutable = reader.byte();
    if (mutable > 1) throw new Error('Unsupported WASM ABI global mutability');
    return { value, mutable: Boolean(mutable) };
}
function skipConstant(reader) {
    const opcode = reader.byte();
    if (opcode === 0x41 || opcode === 0x42) {
        const max = opcode === 0x41 ? 5 : 10;
        let ended = false;
        for (let i = 0; i < max; i++) if (!(reader.byte() & 0x80)) { ended = true; break; }
        if (!ended) throw new Error('Oversized WASM constant');
    } else if (opcode === 0x43) reader.take(4);
    else if (opcode === 0x44) reader.take(8);
    else if (opcode === 0x23 || opcode === 0xd2) reader.u32();
    else if (opcode === 0xd0) valueType(reader);
    else if (opcode === 0xfd && reader.u32() === 12) reader.take(16);
    else throw new Error(`Unsupported WASM global initializer: 0x${opcode.toString(16)}`);
    if (reader.byte() !== 0x0b) throw new Error('Unsupported extended WASM global initializer');
}

export function readAbi(bytes) {
    const reader = new Reader(bytes);
    if (Buffer.from(reader.take(8)).toString('hex') !== '0061736d01000000') {
        throw new Error('Invalid WASM header');
    }
    const types = [], spaces = [[], [], [], []], imports = [], exports = [];
    const typeAt = index => {
        if (!types[index]) throw new Error(`Unknown WASM ABI type ${index}`);
        return types[index];
    };
    while (reader.position < bytes.length) {
        const id = reader.byte(), section = new Reader(reader.take(reader.u32()));
        if (id === 1) {
            types.push(...section.vector(r => {
                if (r.byte() !== 0x60) throw new Error('Unsupported non-function WASM ABI type');
                return { parameters: r.vector(valueType), results: r.vector(valueType) };
            }));
        } else if (id === 2) {
            section.vector(r => {
                const module = r.name(), name = r.name(), kind = r.byte();
                let type;
                if (kind === 0) type = typeAt(r.u32());
                else if (kind === 1) type = tableType(r);
                else if (kind === 2) type = limits(r, true);
                else if (kind === 3) type = globalType(r);
                else throw new Error(`Unsupported WASM ABI import kind ${kind}`);
                spaces[kind].push(type);
                imports.push({ module, name, kind: KIND_NAMES[kind], type });
            });
        } else if (id === 3) spaces[0].push(...section.vector(r => typeAt(r.u32())));
        else if (id === 4) spaces[1].push(...section.vector(tableType));
        else if (id === 5) spaces[2].push(...section.vector(r => limits(r, true)));
        else if (id === 6) {
            spaces[3].push(...section.vector(r => { const type = globalType(r); skipConstant(r); return type; }));
        } else if (id === 7) {
            exports.push(...section.vector(r => {
                const name = r.name(), kind = r.byte(), index = r.u32();
                const type = spaces[kind]?.[index];
                if (!type) throw new Error(`Unsupported or unknown WASM export ${name}, kind ${kind}`);
                return { name, kind: KIND_NAMES[kind], type };
            }));
        } else if (id === 13) throw new Error('WASM exception tags require an ABI parser review');
        else if (![0, 8, 9, 10, 11, 12].includes(id)) throw new Error(`Unsupported WASM section ${id}`);
        else continue; // Custom metadata, code and data do not determine the external ABI.
        section.done();
    }
    const canonical = entries => entries.sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b)));
    return { imports: canonical(imports), exports: canonical(exports) };
}
