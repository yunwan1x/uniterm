class RdpMicProcessor extends AudioWorkletProcessor {
  constructor() {
    super(); this.samples = new Float32Array(1024); this.offset = 0; this.ready = true;
    this.port.onmessage = () => { this.ready = true; };
  }
  process(inputs) {
    const input = inputs[0]?.[0];
    if (!input) return true;
    for (const sample of input) {
      this.samples[this.offset++] = sample;
      if (this.offset === this.samples.length) {
        if (this.ready) { const data = this.samples.slice(); this.port.postMessage(data, [data.buffer]); this.ready = false; }
        this.offset = 0;
      }
    }
    return true;
  }
}
registerProcessor('rdp-microphone', RdpMicProcessor);
