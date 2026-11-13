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
          'android-floating-native': floatKind === 'native',
          'android-toolbar-open': toolbarVisible,
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
        <div v-if="floatKind === 'page'" class="android-resize-edge android-resize-right" @pointerdown.stop="dragFloating($event, 'right')" />
        <div v-if="floatKind === 'page'" class="android-resize-edge android-resize-bottom" @pointerdown.stop="dragFloating($event, 'bottom')" />
        <div
          ref="screen"
          class="android-screen"
          :class="{ 'android-pixel-view': displayMode === 'pixels' }"
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
        <div v-if="error" class="android-error" role="alert">
          <strong>{{ t('android.connectionFailed') }}</strong>
          <p class="android-error-detail">{{ error }}</p>
          <button :disabled="switching" @click="reconnect">{{ t('android.reconnect') }}</button>
        </div>
        <div v-if="!connected && !error" class="android-error" role="status">
          {{ switching ? t('android.switchingSource') : t('android.connecting') }}
        </div>
        <aside v-if="viewOpen" class="android-panel" @keydown.stop>
          <strong>{{ t('android.windowDisplay') }}</strong>
          <button class="close" @click="viewOpen = false">×</button>
          <label>{{ t('android.windowDisplay') }}
            <select v-model="displayMode" :aria-label="t('android.windowDisplay')">
              <option value="fit">{{ t('android.fitWindow') }}</option>
              <option value="pixels">{{ t('android.actualPixels') }}</option>
            </select>
          </label>
          <label>{{ t('android.videoSource') }}
            <select :aria-label="t('android.videoSource')" :value="source" :disabled="switching || !props.config" @change="switchSource">
              <option value="display">{{ t('android.sourceDisplay') }}</option>
              <option value="front">{{ t('android.sourceFront') }}</option>
              <option value="back">{{ t('android.sourceBack') }}</option>
            </select>
          </label>
        </aside>
        <aside v-if="qualityOpen" class="android-panel" @keydown.stop>
          <strong>{{ t('android.videoQuality') }}</strong>
          <button class="close" @click="qualityOpen = false">×</button>
          <label>{{ t('android.videoLimit') }}
            <select v-model="qualitySize">
              <option value="auto">{{ t('android.autoQuality') }}</option>
              <option v-for="size in [1280, 1920, 2560]" :key="size" :value="String(size)">{{ size }} px</option>
              <option value="0">{{ t('android.nativeQuality') }}</option>
            </select>
          </label>
          <label>{{ t('android.frameRate') }}<select v-model.number="qualityFps"><option v-for="fps in [15, 30, 60]" :key="fps" :value="fps">{{ fps }} FPS</option></select></label>
          <label>{{ t('android.bitrate') }}<select v-model.number="qualityBitrate"><option v-for="rate in [2, 4, 8, 12, 20]" :key="rate" :value="rate">{{ rate }} Mbps</option></select></label>
          <p>{{ t('android.qualityHint') }}</p>
          <button :disabled="switching || !props.config" @click="applyQuality">{{ t('android.applyQuality') }}</button>
          <p>{{ t('android.actualVideo') }}: {{ width }} × {{ height }}</p>
        </aside>
        <aside v-if="resolutionOpen" class="android-panel" @keydown.stop>
          <strong>{{ t('android.resolution') }}</strong>
          <button class="close" @click="resolutionOpen = false">×</button>
          <label>{{ t('android.devicePreset') }}
            <select v-model="resolutionPreset" @change="selectResolutionPreset">
              <optgroup v-for="group in ['phone', 'tablet']" :key="group" :label="t('android.presetGroup.' + group)">
                <option v-for="device in androidDevicePresets.filter(d => d.group === group)" :key="device.id" :value="device.id">{{ device.name }} · {{ device.width }} × {{ device.height }} · {{ device.dpi }} DPI</option>
              </optgroup>
              <option value="custom">{{ t('android.customResolution') }}</option>
            </select>
          </label>
          <div v-if="resolutionPreset === 'custom'" class="android-resolution-fields">
            <input v-model.number="resolutionWidth" type="number" min="320" max="4096" :aria-label="t('android.resolutionWidth')" @input="resolutionPreset = 'custom'" />
            ×
            <input v-model.number="resolutionHeight" type="number" min="320" max="4096" :aria-label="t('android.resolutionHeight')" @input="resolutionPreset = 'custom'" />
          </div>
          <label>{{ t('android.displayDensity') }}
            <input v-model.number="resolutionDpi" type="number" min="120" max="960" :aria-label="t('android.displayDensity')" />
          </label>
          <button :disabled="resolutionBusy || !connected" @click="applyResolution(false)">{{ t('android.applyResolution') }}</button>
          <button :disabled="resolutionBusy || !connected" @click="applyResolution(true)">{{ t('android.resetResolution') }}</button>
          <p>{{ t('android.devicePresetHint') }}</p>
          <p>{{ t('android.resolutionHint') }}</p>
          <p role="status">{{ resolutionStatus }}</p>
        </aside>
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
        <div v-if="floatKind === 'native' && !toolbarVisible" class="android-toolbar-edge" aria-hidden="true"
          @pointerenter="showToolbar" @pointerleave="scheduleHideToolbar" />
        <button v-if="floatKind === 'native'" class="android-toolbar-handle"
          :aria-label="t('android.toggleToolbar')" :title="t('android.toggleToolbar')"
          :aria-expanded="toolbarVisible" aria-controls="android-pip-toolbar"
          @pointerenter="showToolbar" @pointerleave="scheduleHideToolbar"
          @click="toolbarPinned = !toolbarPinned; toolbarHovered = toolbarPinned"
        >{{ toolbarVisible ? '›' : '‹' }}</button>
        <footer :id="floatKind === 'native' ? 'android-pip-toolbar' : undefined" aria-label="Android status"
          @pointerenter="showToolbar" @pointerleave="scheduleHideToolbar"
          @focusin="showToolbar" @focusout="scheduleHideToolbar"
        >
          <button
            v-if="floatKind === 'page'"
            class="android-drag"
            :title="t('android.dragFloating')"
            :aria-label="t('android.dragFloating')"
            @pointerdown="dragFloating($event)"
          >
            <GripVertical :size="17" />
          </button>
          <div class="android-status-scroll">
            <span class="android-connection-dot" :class="{ connected }" :title="connected ? t('android.connected') : t('android.connecting')">●</span>
            <button :disabled="!connected || source !== 'display'" :title="`${t('android.resolution')} · ${width} × ${height}`" :aria-label="t('android.resolution')" @click="togglePane('resolution')"><Smartphone :size="17" /></button>
            <button :title="t('android.videoQuality')" :aria-label="t('android.videoQuality')" @click="togglePane('quality')"><SlidersHorizontal :size="17" /></button>
            <button :title="`${t('android.windowDisplay')} · ${t(displayMode === 'fit' ? 'android.fitWindow' : 'android.actualPixels')}`" :aria-label="t('android.windowDisplay')" @click="togglePane('view')"><Scan :size="17" /></button>
            <button :title="`${t('android.videoSource')} · ${t(source === 'display' ? 'android.sourceDisplay' : source === 'front' ? 'android.sourceFront' : 'android.sourceBack')}`" :aria-label="t('android.videoSource')" @click="togglePane('view')"><Camera :size="17" /></button>
            <button v-for="action in navigationActions" :key="action.code" :disabled="!connected || source !== 'display'" :title="action.label" :aria-label="action.label" @click="key(action.code)"><component :is="action.icon" :size="17" /></button>
            <button :disabled="!connected || source !== 'display'" :title="t('android.rotate')" :aria-label="t('android.rotate')" @click="client?.send({ type: 'rotate' })"><RotateCw :size="17" /></button>
            <button :disabled="!connected || source !== 'display'" :title="t('android.text')" :aria-label="t('android.text')" @click="togglePane('text')"><Keyboard :size="17" /></button>
            <button :disabled="!connected" :title="t('android.files')" :aria-label="t('android.files')" @click="togglePane('files')"><Folder :size="17" /></button>
            <button :disabled="!connected" title="Shell" aria-label="Shell" @click="togglePane('shell')"><Terminal :size="17" /></button>
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
            <button v-if="floating" :title="t('android.maximize')" :aria-label="t('android.maximize')" @click="maximize"><Maximize :size="17" /></button>
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
import { computed, ref, watch, onMounted, onBeforeUnmount } from 'vue'
import { PictureInPicture2, PanelTop, Maximize, X, Smartphone, SlidersHorizontal, Scan, Camera, ArrowLeft, House, PanelsTopLeft, Volume2, Volume1, Power, RotateCw, Keyboard, Folder, Terminal, GripVertical } from '@lucide/vue'
import { useFloatingWindow } from '../android/useFloatingWindow'
import { androidDevicePresets } from '../android/devicePresets'
import { androidErrorMessage } from '../android/errors'
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
const source = ref<'display' | 'front' | 'back'>(props.config?.androidVideoSource || 'display')
const switching = ref(false)
const viewOpen = ref(false)
const navigationActions = computed(() => [
  { code: 4, icon: ArrowLeft, label: t('android.back') },
  { code: 3, icon: House, label: t('android.home') },
  { code: 187, icon: PanelsTopLeft, label: t('android.recent') },
  { code: 24, icon: Volume2, label: `＋${t('android.volume')}` },
  { code: 25, icon: Volume1, label: `－${t('android.volume')}` },
  { code: 26, icon: Power, label: t('android.power') },
])
const qualityOpen = ref(false), qualitySize = ref('auto'), qualityFps = ref(30), qualityBitrate = ref(4), displayMode = ref('fit')
const qualityStorageKey = `android-quality:${props.config?.host || ''}:${props.config?.port || 5555}`
try {
  const saved = JSON.parse(localStorage.getItem(qualityStorageKey) || 'null')
  if (saved && ['auto', '0', '1280', '1920', '2560'].includes(saved.size) && [15,30,60].includes(saved.fps) && [2,4,8,12,20].includes(saved.bitrate)) {
    qualitySize.value = saved.size; qualityFps.value = saved.fps; qualityBitrate.value = saved.bitrate
  }
} catch { /* unavailable storage must not block a connection */ }
function videoQuality() {
  const rect = screen.value?.getBoundingClientRect()
  const view = screen.value?.ownerDocument.defaultView || window
  const longest = Math.max(rect?.width || 720, rect?.height || 1280) * view.devicePixelRatio
  const maxSize = qualitySize.value === 'auto' ? Math.min(2560, Math.max(640, Math.ceil(longest / 16) * 16)) : Number(qualitySize.value)
  return { maxSize, maxFps: qualityFps.value, bitrate: qualityBitrate.value * 1000000 }
}
async function applyQuality() {
  try { localStorage.setItem(qualityStorageKey, JSON.stringify({ size: qualitySize.value, fps: qualityFps.value, bitrate: qualityBitrate.value })) } catch { /* optional persistence */ }
  qualityOpen.value = false
  await reconnect()
}
const shellOpen = ref(false),
  command = ref(''),
  shellOutput = ref(''),
  shellBusy = ref(false)
const resolutionOpen = ref(false), resolutionPreset = ref<string>(androidDevicePresets[0].id), resolutionWidth = ref<number>(androidDevicePresets[0].width), resolutionHeight = ref<number>(androidDevicePresets[0].height), resolutionDpi = ref<number>(androidDevicePresets[0].dpi), resolutionBusy = ref(false), resolutionStatus = ref('')
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
  maximize,
} = useFloatingWindow(root, () => {
  const panel = panels.getPanel(props.panelId)
  if (panel?.tabId && tabs.tabs.some((tab) => tab.id === panel.tabId))
    tabs.setActiveTab(panel.tabId)
}, () => ({ width: width.value, height: height.value }))
const toolbarPinned = ref(false), toolbarHovered = ref(false)
let toolbarHideTimer: ReturnType<typeof setTimeout> | undefined
const toolbarVisible = computed(() => toolbarPinned.value || toolbarHovered.value)
function showToolbar() {
  clearTimeout(toolbarHideTimer)
  toolbarHovered.value = true
}
function scheduleHideToolbar() {
  clearTimeout(toolbarHideTimer)
  toolbarHideTimer = setTimeout(() => {
    const footer = root.value?.querySelector('footer')
    if (footer?.contains(footer.ownerDocument.activeElement)) return
    toolbarHovered.value = false
  }, 250)
}
watch(floatKind, () => {
  clearTimeout(toolbarHideTimer)
  toolbarPinned.value = false
  toolbarHovered.value = false
})
onBeforeUnmount(() => clearTimeout(toolbarHideTimer))
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
  if (client.connected) source.value = client.videoSource
  error.value = client.error
  panels.updateStatus(props.panelId, client.error ? 'error' : client.connected ? 'connected' : 'connecting')
  mode.value = client.mode
  width.value = client.width
  height.value = client.height
}
async function connect(fresh = false) {
  try {
    let url = fresh ? '' : panels.getProxyAddr(props.panelId)
    if (!url) {
      if (!props.config) throw new Error(t('android.missingConfig'))
      const info = await CreateSession('android', { ...props.config, androidVideoSource: source.value, androidVideoQuality: videoQuality() })
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
    connected.value = false
    error.value = androidErrorMessage(e)
    panels.updateStatus(props.panelId, 'error')
  }
}
async function reconnect() {
  if (switching.value) return
  switching.value = true
  down = false
  connected.value = false
  error.value = ''
  try {
    if (client) {
      androidClients.delete(client.url)
      client.changed = () => {}
      client.dispose()
      client.canvas.remove()
      client = undefined
    }
    if (sessionId) {
      await CloseSession(sessionId)
      sessionId = undefined
    }
    await connect(true)
  } catch (e) {
    error.value = androidErrorMessage(e)
    panels.updateStatus(props.panelId, 'error')
  } finally {
    switching.value = false
  }
}
async function switchSource(e: Event) {
  const value = (e.target as HTMLSelectElement).value
  if (!['display', 'front', 'back'].includes(value) || switching.value) return
  source.value = value as typeof source.value
  textOpen.value = false
  resolutionOpen.value = false
  await reconnect()
}
function sendText() {
  client?.send({ type: 'paste', text: text.value })
  text.value = ''
}
function togglePane(pane: string) {
  const open =
    pane === 'view' ? !viewOpen.value : pane === 'quality' ? !qualityOpen.value : pane === 'resolution' ? !resolutionOpen.value : pane === 'text'
      ? !textOpen.value
      : pane === 'files'
        ? !files.value
        : !shellOpen.value
  viewOpen.value = pane === 'view' && open
  qualityOpen.value = pane === 'quality' && open
  resolutionOpen.value = pane === 'resolution' && open
  textOpen.value = pane === 'text' && open
  files.value = pane === 'files' && open
  shellOpen.value = pane === 'shell' && open
}
function selectResolutionPreset() {
  if (resolutionPreset.value === 'custom') return
  const preset = androidDevicePresets.find(device => device.id === resolutionPreset.value)
  if (!preset) return
  resolutionWidth.value = preset.width
  resolutionHeight.value = preset.height
  resolutionDpi.value = preset.dpi
}
async function applyResolution(reset: boolean) {
  if (!client || source.value !== 'display' || resolutionBusy.value) return
  const w = resolutionWidth.value, h = resolutionHeight.value
  if (!reset && (!Number.isInteger(w) || !Number.isInteger(h) || w < 320 || h < 320 || w > 4096 || h > 4096)) {
    resolutionStatus.value = t('android.invalidResolution'); return
  }
  if (!reset && (!Number.isInteger(resolutionDpi.value) || resolutionDpi.value < 120 || resolutionDpi.value > 960)) {
    resolutionStatus.value = t('android.invalidDensity'); return
  }
  resolutionBusy.value = true
  resolutionStatus.value = ''
  try {
    const result = await fetch(client.httpURL('resolution', ''), {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ width: w, height: h, dpi: resolutionDpi.value, reset }),
    })
    if (!result.ok) throw Error(await result.text())
    resolutionStatus.value = t('android.done')
  } catch (e) { resolutionStatus.value = String(e) }
  finally { resolutionBusy.value = false }
}
function key(key: number) {
  if (source.value !== 'display') return
  client?.enableAudio()
  client?.send({ type: 'key', key })
}
function touch(e: PointerEvent, action: number) {
  if (!client || !connected.value) return
  client.enableAudio()
  if (source.value !== 'display') return
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
  if (source.value !== 'display') return
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
  if (source.value !== 'display') return
  const text = e.clipboardData?.getData('text/plain')
  if (text) client?.send({ type: 'paste', text })
}
function keyboard(e: KeyboardEvent) {
  if (source.value !== 'display') return
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
  background: var(--bg-surface);
  border: 1px solid var(--border-subtle);
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
  border: 1px solid var(--border-subtle);
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

.android-window-notice {
  font-size: 12px;
  margin: 0;
  padding: 4px 8px;
  background: var(--bg-elevated);
  color: var(--text-secondary);
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
  box-sizing: border-box;
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
  background: var(--bg-surface);
  font-size: 12px;
}
.android-source {
  font: inherit;
  max-width: 160px;
}
.android-tab button,
.android-source {
  background: var(--bg-elevated);
  color: var(--text-primary);
  border: 1px solid var(--border-subtle);
  border-radius: 5px;
  padding: 5px 8px;
  cursor: pointer;
}
.android-tab button:disabled {
  opacity: 0.4;
}
.android-error {
  position: absolute;
  top: 16px;
  left: 16px;
  right: 16px;
  z-index: 10;
  background: var(--bg-surface);
  color: var(--text-primary);
  padding: 16px;
  border: 1px solid var(--border-subtle);
  border-radius: 8px;
  box-sizing: border-box;
  max-height: calc(100% - 80px);
  overflow: auto;
  box-shadow: 0 6px 24px #0005;
}
.android-error-detail { white-space: pre-wrap; overflow-wrap: anywhere; font-size: 13px; line-height: 1.5; margin: 10px 0; user-select: text; }
.android-panel {
  position: absolute;
  bottom: 58px;
  right: 12px;
  width: min(360px, 90%);
  padding: 16px;
  background: var(--bg-surface);
  border: 1px solid var(--border-subtle);
  border-radius: 10px;
  box-shadow: 0 8px 25px #0008;
}
.android-resize-edge { position: absolute; z-index: 20; touch-action: none; }
.android-resize-right { right: 0; top: 0; bottom: 14px; width: 6px; cursor: ew-resize; }
.android-resize-bottom { bottom: 0; left: 0; right: 14px; height: 6px; cursor: ns-resize; }
.android-panel label {
  display: block;
  margin: 12px 0;
}
.android-panel input,
.android-panel textarea,
.android-panel select {
  width: 100%;
  box-sizing: border-box;
  background: var(--bg-base);
  color: var(--text-primary);
  border: 1px solid var(--border-subtle);
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
.android-tab button:hover:not(:disabled) { background: var(--bg-hover); }
.android-tab button:focus-visible, .android-source:focus-visible { outline: 2px solid var(--accent); }
.android-connection-dot { color: var(--text-muted); }
.android-connection-dot.connected { color: var(--success); }
.android-resolution-fields { display: flex; align-items: center; gap: 8px; margin-bottom: 12px; }
.android-resolution-fields input { min-width: 0; }
.android-floating { display: grid; grid-template-columns: minmax(0, 1fr) 44px; grid-template-rows: minmax(0, 1fr); }
.android-floating .android-screen { min-width: 0; grid-column: 1; grid-row: 1; }
.android-floating footer { grid-column: 2; grid-row: 1; min-height: 0; padding: 6px; flex-direction: column; overflow: hidden; border-left: 1px solid var(--border-subtle); }
.android-floating .android-status-scroll { flex-direction: column; width: 100%; min-height: 0; overflow-x: hidden; overflow-y: auto; align-items: stretch; }
.android-floating .android-source { width: 100%; min-width: 0; font-size: 11px; }
.android-floating .android-window-actions { flex-wrap: wrap; justify-content: center; margin: 0; }
.android-floating .android-panel { right: 52px; bottom: 8px; width: min(360px, calc(100% - 68px)); box-sizing: border-box; max-height: calc(100% - 16px); overflow: auto; }
.android-floating .android-window-notice { position: absolute; left: 0; bottom: 0; right: 44px; }
.android-screen.android-pixel-view { overflow: auto; display: block; touch-action: none; }
.android-screen.android-pixel-view :deep(canvas) { max-width: none; max-height: none; flex-shrink: 0; }
.android-panel label select { width: 100%; }
.android-floating .android-status-scroll > select { width: 100%; min-width: 0; }
.android-status-scroll > select { background: var(--bg-surface); color: var(--text-primary); border: 1px solid var(--border-subtle); border-radius: 4px; padding: 4px; font-size: 12px; }
/* Native PiP keeps all controls inside the OS window, over the full-width video. */
.android-floating-native { grid-template-columns: minmax(0, 1fr); overflow: hidden; }
.android-floating-native footer {
  position: absolute; top: 0; right: 0; bottom: 0; width: 44px;
  box-sizing: border-box; z-index: 5; background: var(--bg-surface);
  box-shadow: -4px 0 16px #0004;
  visibility: hidden; transform: translateX(100%); pointer-events: none;
  transition: transform 160ms ease, visibility 160ms;
}
.android-floating-native.android-toolbar-open footer { visibility: visible; transform: translateX(0); pointer-events: auto; }
.android-floating-native .android-toolbar-edge { position: absolute; right: 0; top: 0; bottom: 0; width: 6px; z-index: 5; }
.android-floating-native .android-toolbar-handle {
  position: absolute; right: 0; top: 50%; transform: translateY(-50%);
  z-index: 6; width: 22px; height: 48px; padding: 0;
  border-radius: 7px 0 0 7px; background: var(--bg-elevated);
  color: var(--text-primary); opacity: .75;
}
.android-floating-native.android-toolbar-open .android-toolbar-handle { right: 44px; }
.android-floating-native .android-panel { z-index: 7; right: 8px; width: calc(100% - 16px); }
.android-floating-native .android-window-notice { right: 0; }
@media (prefers-reduced-motion: reduce) { .android-floating-native footer { transition: none; } }
.android-status-scroll > button { display: inline-flex; align-items: center; justify-content: center; min-width: 32px; height: 32px; padding: 0 6px; }
.android-floating footer { padding: 4px; }
.android-floating .android-status-scroll { gap: 3px; align-items: center; }
.android-floating .android-status-scroll > button, .android-floating .android-window-actions > button { width: 32px; min-width: 32px; height: 32px; padding: 0; display: inline-flex; align-items: center; justify-content: center; }
.android-floating .android-window-actions { flex-direction: column; gap: 3px; }
.android-floating .android-connection-dot { font-size: 10px; line-height: 16px; }
</style>
