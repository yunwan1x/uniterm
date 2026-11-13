<template>
  <div class="android-host">
    <div v-if="floating" class="android-placeholder">
      <p>{{ t('android.floatingActive') }}</p>
      <button @click="restore">{{ t('android.restore') }}</button>
      <button @click="focusFloating">{{ t('android.focusFloating') }}</button>
    </div>
    <Teleport :to="floatingTarget || 'body'" :disabled="!floating">
      <section
        ref="root"
        class="android-tab"
        :class="{
          'android-floating': floating,
          'android-floating-page': floatKind === 'page',
        }"
        :style="floatingStyle"
      >
        <button
          v-if="floatKind === 'page'"
          class="android-resize"
          :aria-label="t('android.resizeFloating')"
          @pointerdown="dragFloating($event, true)"
        >
          ◢
        </button>
        <div
          ref="screen"
          class="android-screen"
          tabindex="0"
          @pointerdown="touch($event, 0)"
          @pointermove="move"
          @pointerup="touch($event, 1)"
          @pointercancel="touch($event, 1)"
          @wheel.prevent="wheel"
          @keydown="keyboard"
          @paste.prevent="paste"
          @contextmenu.prevent="key(4)"
        />
        <div v-if="error" class="android-error">
          {{ error }}
          <button @click="reconnect">{{ t('android.reconnect') }}</button>
        </div>
        <div v-if="!connected && !error" class="android-error">
          {{ t('android.connecting') }}
        </div>
        <aside v-if="shellOpen" class="android-panel" @keydown.stop>
          <strong>ADB Shell</strong
          ><button class="close" @click="shellOpen = false">×</button
          ><input
            v-model="command"
            @keydown.enter="runShell"
            placeholder="getprop ro.build.version.release"
          /><button :disabled="shellBusy" @click="runShell">
            {{ t('android.send') }}
          </button>
          <pre>{{ shellOutput }}</pre>
        </aside>
        <aside v-if="files" class="android-panel" @keydown.stop>
          <strong>{{ t('android.files') }}</strong><button
            class="close"
            @click="files = false"
          >
            ×
          </button>
          <label
            >{{ t('android.path')
            }}<input v-model="path" placeholder="/sdcard/Download/"
          /></label>
          <label
            >{{ t('android.upload')
            }}<input type="file" :disabled="busy" @change="upload"
          /></label>
          <button :disabled="busy" @click="download">
            {{ t('android.download') }}
          </button>
          <p>{{ t('android.fileHint') }}</p>
          <p role="status">{{ fileStatus }}</p>
        </aside>
        <aside v-if="textOpen" class="android-panel" @keydown.stop>
          <strong>{{ t('android.text') }}</strong><button
            class="close"
            @click="textOpen = false"
          >
            ×</button
          ><textarea v-model="text" maxlength="4096" /><button
            @click="sendText"
          >
            {{ t('android.send') }}
          </button>
          <p>{{ t('android.textHint') }}</p>
        </aside>
        <p v-if="windowNotice" class="android-window-notice" role="status">
          {{ windowNotice }}
        </p>
        <footer aria-label="Android status">
          <button
            v-if="floatKind === 'page'"
            class="android-drag"
            :title="t('android.dragFloating')"
            :aria-label="t('android.dragFloating')"
            @pointerdown="dragFloating($event)"
          >
            ⠿
          </button>
          <div class="android-status-scroll">
            <span
              >{{ connected ? '●' : '○' }} Android · {{ width }} ×
              {{ height }} · {{ mode }}</span
            >
            <button :disabled="!connected" @click="key(4)">
              {{ t('android.back') }}</button><button
              :disabled="!connected"
              @click="key(3)"
            >
              {{ t('android.home') }}</button
            ><button :disabled="!connected" @click="key(187)">
              {{ t('android.recent') }}
            </button>
            <button :disabled="!connected" @click="key(24)">
              ＋{{ t('android.volume') }}</button
            ><button :disabled="!connected" @click="key(25)">
              －{{ t('android.volume') }}</button
            ><button :disabled="!connected" @click="key(26)">
              {{ t('android.power') }}
            </button>
            <button
              :disabled="!connected"
              @click="client?.send({ type: 'rotate' })"
            >
              {{ t('android.rotate') }}</button><button
              :disabled="!connected"
              @click="togglePane('text')"
            >
              {{ t('android.text') }}</button
            ><button :disabled="!connected" @click="togglePane('files')">
              {{ t('android.files') }}</button
            ><button :disabled="!connected" @click="togglePane('shell')">
              Shell
            </button>
          </div>
          <div class="android-window-actions">
            <button
              v-if="!floating"
              :disabled="opening || !connected"
              :title="t('android.floating')"
              @click="openFloating"
            >
              <PictureInPicture2 :size="15" /><span>{{
                t('android.floating')
              }}</span>
            </button>
            <button v-else :title="t('android.restore')" @click="restore">
              <PanelTop :size="15" /><span>{{ t('android.restore') }}</span>
            </button>
            <button
              v-if="floatKind !== 'native'"
              :title="t('android.fullscreen')"
              @click="fullscreen"
            >
              <Maximize :size="15" /><span>{{ t('android.fullscreen') }}</span>
            </button>
            <button
              v-if="floating"
              :title="t('android.closeFloating')"
              :aria-label="t('android.closeFloating')"
              @click="restore"
            >
              <X :size="15" />
            </button>
          </div>
        </footer>
      </section>
    </Teleport>
  </div>
</template>
<script setup lang="ts">
import { ref, watch, onMounted, onBeforeUnmount } from 'vue'
import { PictureInPicture2, PanelTop, Maximize, X } from '@lucide/vue'
import { useFloatingWindow } from '../android/useFloatingWindow'
import { AndroidClient, androidClients } from '../android/client'
import { usePanelStore } from '../stores/panelStore'
import { useTabStore } from '../stores/tabStore'
import { useSessionStore } from '../stores/sessionStore'
import {
  CreateSession,
  CloseSession,
} from '../../bindings/github.com/ys-ll/uniterm/app'
import type { ConnectionConfig } from '../types/session'
import { useI18n } from '../i18n'
const props = defineProps<{
  panelId: string
  config?: ConnectionConfig | null
  sessionId?: string | null
}>()
const { t } = useI18n(),
  panels = usePanelStore(),
  tabs = useTabStore(),
  sessions = useSessionStore()
const root = ref<HTMLElement>(),
  screen = ref<HTMLElement>(),
  connected = ref(false),
  error = ref(''),
  mode = ref(''),
  width = ref(720),
  height = ref(1280)
const shellOpen = ref(false),
  command = ref(''),
  shellOutput = ref(''),
  shellBusy = ref(false)
const files = ref(false),
  textOpen = ref(false),
  text = ref(''),
  path = ref('/sdcard/Download/'),
  busy = ref(false),
  fileStatus = ref('')
const {
  kind: floatKind,
  target: floatingTarget,
  opening,
  notice: windowNotice,
  floating,
  style: floatingStyle,
  open: openFloating,
  restore,
  focus: focusFloating,
  drag: dragFloating,
  fullscreen,
} = useFloatingWindow(root, () => {
  const panel = panels.getPanel(props.panelId)
  if (panel?.tabId && tabs.tabs.some((tab) => tab.id === panel.tabId))
    tabs.setActiveTab(panel.tabId)
})
// KeepAlive caches inactive tabs; explicit panel deletion must still close its window.
watch(
  () => panels.getPanel(props.panelId),
  (panel) => {
    if (!panel) {
      void restore()
      client?.dispose()
      if (client) androidClients.delete(client.url)
    }
  },
)
let client: AndroidClient | undefined,
  down = false,
  mounted = true,
  sessionId = props.sessionId
function update() {
  if (!client) return
  connected.value = client.connected
  error.value = client.error
  mode.value = client.mode
  width.value = client.width
  height.value = client.height
}
async function connect(fresh = false) {
  try {
    let url = fresh ? '' : panels.getProxyAddr(props.panelId)
    if (!url) {
      if (!props.config) return
      const info = await CreateSession('android', props.config)
      if (!mounted || !panels.getPanel(props.panelId)) {
        await CloseSession(info.id)
        return
      }
      url = info.proxyAddr
      sessionId = info.id
      panels.bindSession(props.panelId, info.id)
      panels.setProxyAddr(props.panelId, url || '')
      sessions.initSession(info.id)
    }
    if (!url) throw Error('Missing Android session URL')
    client = androidClients.get(url)
    if (!client) {
      client = new AndroidClient(url)
      androidClients.set(url, client)
    }
    client.changed = update
    screen.value?.replaceChildren(client.canvas)
    update()
  } catch (e) {
    error.value = String(e)
  }
}
async function reconnect() {
  client?.dispose()
  if (sessionId) await CloseSession(sessionId)
  error.value = ''
  await connect(true)
}
function sendText() {
  client?.send({ type: 'paste', text: text.value })
  text.value = ''
}
function togglePane(pane: string) {
  const open =
    pane === 'text'
      ? !textOpen.value
      : pane === 'files'
        ? !files.value
        : !shellOpen.value
  textOpen.value = pane === 'text' && open
  files.value = pane === 'files' && open
  shellOpen.value = pane === 'shell' && open
}
function key(key: number) {
  client?.enableAudio()
  client?.send({ type: 'key', key })
}
function touch(e: PointerEvent, action: number) {
  if (!client || !connected.value) return
  const canvas = client.canvas,
    r = canvas.getBoundingClientRect()
  if (!r.width || !r.height) return
  if (action === 0) {
    if (e.button !== 0) return
    down = true
    screen.value?.setPointerCapture(e.pointerId)
    screen.value?.focus()
    client.enableAudio()
  }
  if (!down) return
  e.preventDefault()
  client.send({
    type: 'touch',
    action,
    x: Math.max(
      0,
      Math.min(
        client.width - 1,
        Math.floor(((e.clientX - r.left) / r.width) * client.width),
      ),
    ),
    y: Math.max(
      0,
      Math.min(
        client.height - 1,
        Math.floor(((e.clientY - r.top) / r.height) * client.height),
      ),
    ),
    width: client.width,
    height: client.height,
  })
  if (action === 1) down = false
}
function wheel(e: WheelEvent) {
  if (!client) return
  const r = client.canvas.getBoundingClientRect()
  client.send({
    type: 'scroll',
    x: Math.max(
      0,
      Math.min(
        client.width - 1,
        Math.floor(((e.clientX - r.left) / r.width) * client.width),
      ),
    ),
    y: Math.max(
      0,
      Math.min(
        client.height - 1,
        Math.floor(((e.clientY - r.top) / r.height) * client.height),
      ),
    ),
    width: client.width,
    height: client.height,
    scrollX: -Math.sign(e.deltaX) * 32767,
    scrollY: -Math.sign(e.deltaY) * 32767,
  })
}
function move(e: PointerEvent) {
  if (down) touch(e, 2)
}
function paste(e: ClipboardEvent) {
  const text = e.clipboardData?.getData('text/plain')
  if (text) client?.send({ type: 'paste', text })
}
function keyboard(e: KeyboardEvent) {
  const map: Record<string, number> = {
    Enter: 66,
    Backspace: 67,
    Escape: 4,
    Tab: 61,
    ArrowUp: 19,
    ArrowDown: 20,
    ArrowLeft: 21,
    ArrowRight: 22,
    Delete: 112,
  }
  if (map[e.key]) {
    e.preventDefault()
    key(map[e.key])
  } else if (e.key.length === 1 && !e.ctrlKey && !e.metaKey) {
    e.preventDefault()
    client?.send({ type: 'text', text: e.key })
  }
}
async function upload(e: Event) {
  const input = e.target as HTMLInputElement,
    file = input.files?.[0]
  if (!file || !client) return
  busy.value = true
  fileStatus.value = t('android.transferring')
  try {
    if (file.size > 256 * 1024 * 1024) throw Error(t('android.limit'))
    const target = path.value.endsWith('/')
      ? path.value + file.name
      : path.value
    const r = await fetch(client.httpURL('upload', target), {
      method: 'POST',
      body: file,
    })
    if (!r.ok) throw Error(await r.text())
    fileStatus.value = t('android.done')
  } catch (e) {
    fileStatus.value = String(e)
  } finally {
    busy.value = false
    input.value = ''
  }
}
async function download() {
  if (!client) return
  busy.value = true
  fileStatus.value = t('android.transferring')
  try {
    const r = await fetch(client.httpURL('download', path.value))
    if (!r.ok) throw Error(await r.text())
    const blob = await r.blob()
    if (blob.size > 256 * 1024 * 1024) throw Error(t('android.limit'))
    const url = URL.createObjectURL(blob),
      a = document.createElement('a')
    a.href = url
    a.download = path.value.split('/').pop() || 'download'
    a.click()
    setTimeout(() => URL.revokeObjectURL(url), 60000)
    fileStatus.value = t('android.done')
  } catch (e) {
    fileStatus.value = String(e)
  } finally {
    busy.value = false
  }
}
async function runShell() {
  if (!client || shellBusy.value) return
  shellBusy.value = true
  try {
    const r = await fetch(client.httpURL('shell', ''), {
      method: 'POST',
      body: command.value,
    })
    shellOutput.value = await r.text()
  } catch (e) {
    shellOutput.value = String(e)
  } finally {
    shellBusy.value = false
  }
}
function onReconnect(e: Event) {
  if ((e as CustomEvent).detail?.panelId === props.panelId) void reconnect()
}
onMounted(() => {
  window.addEventListener('panel:reconnect', onReconnect)
  void connect()
})
onBeforeUnmount(() => {
  if (down && client)
    client.send({
      type: 'touch',
      action: 1,
      x: 0,
      y: 0,
      width: client.width,
      height: client.height,
    })
  mounted = false
  window.removeEventListener('panel:reconnect', onReconnect)
  if (client) client.changed = () => {}
  client?.canvas.remove()
})
</script>
<style scoped>
.android-host {
  height: 100%;
  min-height: 0;
}
.android-placeholder {
  height: 100%;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 12px;
  color: var(--text-primary);
}
.android-placeholder button {
  padding: 8px 16px;
  color: var(--text-primary);
  background: var(--bg-secondary);
  border: 1px solid var(--border-color);
  border-radius: 6px;
  cursor: pointer;
}
.android-status-scroll {
  display: flex;
  align-items: center;
  gap: 6px;
  min-width: 0;
  flex: 1;
  overflow-x: auto;
  white-space: nowrap;
}
.android-status-scroll > * {
  flex-shrink: 0;
}
.android-window-actions {
  display: flex;
  align-items: center;
  gap: 4px;
  flex-shrink: 0;
  margin-left: auto;
}
.android-floating .android-window-actions button span {
  display: none;
}
.android-window-actions button {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  white-space: nowrap;
}
.android-floating {
  width: 100%;
  height: 100%;
}
.android-floating-page {
  position: fixed !important;
  z-index: 2000;
  border: 1px solid var(--border-color, #555);
  border-radius: 9px;
  overflow: hidden;
  box-shadow: 0 12px 48px #0009;
}
.android-tab .android-resize {
  position: absolute;
  right: 0;
  bottom: 0;
  z-index: 3;
  padding: 0;
  width: 14px;
  height: 14px;
  cursor: nwse-resize;
  touch-action: none;
  background: transparent;
  border: 0;
}
.android-tab .android-drag {
  cursor: move;
  touch-action: none;
}
.android-floating-page footer {
  padding-right: 18px;
}
.android-floating .android-status-scroll > span {
  display: none;
}
.android-window-notice {
  font-size: 12px;
  margin: 0;
  padding: 4px 8px;
  background: #663c16;
  color: white;
}
.android-tab:fullscreen {
  width: 100vw !important;
  height: 100vh !important;
  left: 0 !important;
  top: 0 !important;
  border: 0;
  border-radius: 0;
}

.android-tab {
  height: 100%;
  display: flex;
  flex-direction: column;
  position: relative;
  background: #111;
  color: var(--text-primary);
  min-height: 0;
}
.android-screen {
  flex: 1;
  min-height: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  overflow: hidden;
  touch-action: none;
  outline: none;
}
.android-screen :deep(canvas) {
  max-height: 100%;
  max-width: 100%;
  object-fit: contain;
  width: auto;
  height: auto;
}
.android-tab footer {
  display: flex;
  align-items: center;
  gap: 6px;
  flex-wrap: nowrap;
  min-width: 0;
  padding: 7px;
  background: var(--bg-secondary);
  font-size: 12px;
}
.android-tab button {
  background: var(--bg-tertiary);
  color: var(--text-primary);
  border: 1px solid var(--border-color);
  border-radius: 5px;
  padding: 5px 8px;
  cursor: pointer;
}
.android-tab button:disabled {
  opacity: 0.4;
}
.android-error {
  position: absolute;
  top: 20px;
  left: 20px;
  background: var(--bg-secondary);
  padding: 15px;
  max-width: 80%;
}
.android-panel {
  position: absolute;
  bottom: 58px;
  right: 12px;
  width: min(360px, 90%);
  padding: 16px;
  background: var(--bg-secondary);
  border: 1px solid var(--border-color);
  border-radius: 10px;
  box-shadow: 0 8px 25px #0008;
}
.android-panel label {
  display: block;
  margin: 12px 0;
}
.android-panel input,
.android-panel textarea {
  width: 100%;
  box-sizing: border-box;
  background: var(--bg-primary);
  color: var(--text-primary);
  border: 1px solid var(--border-color);
  padding: 7px;
}
.android-panel p {
  font-size: 12px;
  color: var(--text-secondary);
  word-break: break-word;
}
.close {
  float: right;
}
.android-panel pre {
  white-space: pre-wrap;
  max-height: 240px;
  overflow: auto;
  user-select: text;
}
</style>
