import { flushPromises, mount, type DOMWrapper, type VueWrapper } from '@vue/test-utils'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import type { PluginInstallation } from '@/api/admin/plugins'
import en from '@/i18n/locales/en/admin/plugins'
import zh from '@/i18n/locales/zh/admin/plugins'
import PluginsView from '../PluginsView.vue'

const {
  listPlugins,
  uploadPlugin,
  enablePlugin,
  disablePlugin,
  removePlugin,
  testLocale,
  savePluginConfig,
  createUISession,
  stepUpRun,
} = vi.hoisted(() => ({
  listPlugins: vi.fn(),
  uploadPlugin: vi.fn(),
  enablePlugin: vi.fn(),
  disablePlugin: vi.fn(),
  removePlugin: vi.fn(),
  testLocale: { value: 'keys' as 'keys' | 'en' | 'zh' },
  savePluginConfig: vi.fn(),
  createUISession: vi.fn(),
  stepUpRun: vi.fn((action: () => Promise<unknown>) => action()),
}))

vi.mock('@/api/admin', () => ({
  adminAPI: {
    plugins: {
      list: listPlugins,
      upload: uploadPlugin,
      enable: enablePlugin,
      disable: disablePlugin,
      remove: removePlugin,
      getConfig: vi.fn().mockResolvedValue({}),
      saveConfig: savePluginConfig,
      test: vi.fn().mockResolvedValue({ success: true, message: 'ok', latency_ms: 1 }),
      createUISession,
    },
  },
}))

vi.mock('@/stores', () => ({
  useAppStore: () => ({
    showError: vi.fn(),
    showSuccess: vi.fn(),
    showInfo: vi.fn(),
  }),
}))

vi.mock('@/composables/useStepUp', () => ({
  useStepUp: () => ({ run: stepUpRun }),
  isStepUpBlocked: () => false,
  isStepUpCancelled: () => false,
  stepUpBlockReason: () => '',
}))

vi.mock('vue-i18n', async (importOriginal) => ({
  ...(await importOriginal<typeof import('vue-i18n')>()),
  useI18n: () => ({
    t: (key: string) => {
      if (testLocale.value === 'keys' || !key.startsWith('admin.plugins.')) return key
      const messages = testLocale.value === 'en' ? en.plugins : zh.plugins
      return (messages as Record<string, string>)[key.slice('admin.plugins.'.length)] ?? key
    },
  }),
}))

const plugin: PluginInstallation = {
  id: 7,
  plugin_key: 'local.test.transport',
  name: 'Test Transport',
  version: '1.0.0',
  description: '',
  author: 'test',
  manifest: {
    schema_version: 1,
    id: 'local.test.transport',
    name: 'Test Transport',
    version: '1.0.0',
    requires: {
      sub2api: '>=0.1.0',
      plugin_protocol: 1,
      transport_api: 1,
      ui_bridge: 1,
    },
    capabilities: [{ id: 'openai.oauth.outbound_transport.v1', platform: 'openai', account_type: 'oauth' }],
    ui: { entrypoint: 'ui/index.html' },
  },
  binary_sha256: 'a'.repeat(64),
  signature_status: 'trusted' as const,
  state: 'disabled' as const,
  last_error: '',
  installed_at: '2026-08-22T00:00:00Z',
  updated_at: '2026-08-22T00:00:00Z',
  bindings: [
    {
      id: 1,
      plugin_id: 7,
      capability: 'openai.oauth.outbound_transport.v1',
      platform: 'openai',
      account_type: 'oauth',
      enabled: false,
      rollout_percent: 100,
    },
  ],
  compatibility: {
    compatible: true,
    tested: true,
    status: 'compatible' as const,
    message: '',
    current_sub2api_version: '0.1.0',
    required_sub2api_version: '>=0.1.0',
    recommended_sub2api_version: '0.1.0',
    plugin_protocol: 1,
    transport_api: 1,
    ui_bridge: 1,
  },
  runtime_healthy: false,
  runtime_message: '',
}

function telemetryPlugin(overrides: Partial<PluginInstallation> = {}): PluginInstallation {
  return {
    ...structuredClone(plugin),
    id: 8,
    plugin_key: 'local.test.user-telemetry',
    name: 'Test User Telemetry',
    manifest: {
      ...structuredClone(plugin.manifest),
      id: 'local.test.user-telemetry',
      name: 'Test User Telemetry',
      requires: { sub2api: '>=0.1.0', plugin_protocol: 1, user_telemetry_api: 1, ui_bridge: 1 },
      capabilities: [{ id: 'sub2api.user_telemetry.read.v1', platform: 'sub2api', account_type: 'user' }],
    },
    compatibility: { ...plugin.compatibility, transport_api: 0, user_telemetry_api: 1 },
    bindings: [],
    ...overrides,
  }
}

const mountedViews: VueWrapper[] = []

function mountView() {
  const wrapper = mount(PluginsView, {
    global: {
      stubs: {
        AppLayout: { template: '<div><slot /></div>' },
        BaseDialog: { template: '<div><slot /></div>' },
        Icon: true,
        TotpStepUpDialog: true,
      },
    },
  })
  mountedViews.push(wrapper)
  return wrapper
}

function actionButton(scope: VueWrapper | DOMWrapper<Element>, action: string) {
  const button = scope.findAll('button').find((item) => item.text() === `admin.plugins.${action}`)
  expect(button, `${action} button`).toBeDefined()
  return button!
}

describe('管理员插件页生命周期与二次验证', () => {
  beforeEach(() => {
    vi.resetAllMocks()
    testLocale.value = 'keys'
    stepUpRun.mockImplementation((action: () => Promise<unknown>) => action())
    listPlugins.mockResolvedValue([plugin])
    uploadPlugin.mockResolvedValue(plugin)
    enablePlugin.mockResolvedValue(plugin)
    disablePlugin.mockResolvedValue(plugin)
    removePlugin.mockResolvedValue(undefined)
    savePluginConfig.mockResolvedValue({ enabled: true })
    createUISession.mockResolvedValue({
      url: '/api/v1/plugin-ui/token/index.html#bridge_token=bridge',
      bridge_token: 'bridge',
      ui_bridge_version: 1,
      expires_at: '2026-08-22T01:00:00Z',
    })
  })

  afterEach(() => {
    mountedViews.splice(0).forEach((wrapper) => wrapper.unmount())
    vi.restoreAllMocks()
  })

  it('启用插件通过 step-up 控制器执行', async () => {
    const wrapper = mountView()
    await flushPromises()

    const button = wrapper.findAll('button').find((item) => item.text().includes('admin.plugins.enable'))
    expect(button).toBeDefined()
    await button!.trigger('click')
    await flushPromises()

    expect(stepUpRun).toHaveBeenCalledTimes(1)
    expect(enablePlugin).toHaveBeenCalledWith(7, 100, false)
  })

  it('上传插件通过 step-up 控制器执行', async () => {
    const wrapper = mountView()
    await flushPromises()
    const input = wrapper.get('input[type="file"]')
    Object.defineProperty(input.element, 'files', {
      configurable: true,
      value: [new File(['plugin'], 'transport.s2plugin', { type: 'application/zip' })],
    })

    await input.trigger('change')
    await flushPromises()

    expect(stepUpRun).toHaveBeenCalledTimes(1)
    expect(uploadPlugin).toHaveBeenCalledTimes(1)
  })

  it.each([true, false])('无 bindings 的已启用遥测使用生命周期状态（healthy=%s）', async (healthy) => {
    listPlugins.mockResolvedValue([telemetryPlugin({ state: 'enabled', runtime_healthy: healthy })])
    const wrapper = mountView()
    await flushPromises()
    const card = wrapper.get('article')
    expect(actionButton(card, 'disable').attributes('disabled')).toBeUndefined()
    expect(card.findAll('button').some((button) => button.text() === 'admin.plugins.enable')).toBe(false)
    expect(actionButton(card, 'uninstall').attributes('disabled')).toBeDefined()
    expect(card.find('input[type="range"]').exists()).toBe(false)
    expect(card.text()).toContain('admin.plugins.telemetryScope')
    await actionButton(card, 'uninstall').trigger('click')
    expect(removePlugin).not.toHaveBeenCalled()
    expect(enablePlugin).not.toHaveBeenCalled()
  })

  it('无 bindings 遥测先停用再卸载，均通过 step-up 并刷新列表', async () => {
    const enabled = telemetryPlugin({ state: 'enabled', runtime_healthy: true })
    const disabled = telemetryPlugin()
    listPlugins.mockResolvedValue([enabled])
    disablePlugin.mockResolvedValue(disabled)
    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(true)
    const wrapper = mountView()
    await flushPromises()
    listPlugins.mockResolvedValue([disabled])
    await actionButton(wrapper.get('article'), 'disable').trigger('click')
    await flushPromises()
    expect(confirm).toHaveBeenLastCalledWith('admin.plugins.confirmDisableTelemetry')
    expect(disablePlugin).toHaveBeenCalledWith(8)
    expect(stepUpRun).toHaveBeenCalledTimes(1)
    const card = wrapper.get('article')
    expect(actionButton(card, 'enable').attributes('disabled')).toBeUndefined()
    expect(actionButton(card, 'uninstall').attributes('disabled')).toBeUndefined()
    expect(card.findAll('button').some((button) => button.text() === 'admin.plugins.disable')).toBe(false)
    listPlugins.mockResolvedValue([])
    await actionButton(card, 'uninstall').trigger('click')
    await flushPromises()
    expect(confirm).toHaveBeenLastCalledWith('admin.plugins.confirmUninstall')
    expect(removePlugin).toHaveBeenCalledWith(8)
    expect(stepUpRun).toHaveBeenCalledTimes(2)
    expect(listPlugins).toHaveBeenCalledTimes(3)
    expect(wrapper.find('article').exists()).toBe(false)
  })

  it('取消停用遥测时不请求后台', async () => {
    listPlugins.mockResolvedValue([telemetryPlugin({ state: 'enabled' })])
    vi.spyOn(window, 'confirm').mockReturnValue(false)
    const wrapper = mountView()
    await flushPromises()
    await actionButton(wrapper.get('article'), 'disable').trigger('click')
    expect(disablePlugin).not.toHaveBeenCalled()
    expect(stepUpRun).not.toHaveBeenCalled()
  })

  it('停用遥测不显示灰度，启用只传兼容 API 要求的固定比例', async () => {
    listPlugins.mockResolvedValue([telemetryPlugin({
      bindings: [{
        id: 2, plugin_id: 8, capability: 'sub2api.user_telemetry.read.v1',
        platform: 'sub2api', account_type: 'user', enabled: false, rollout_percent: 23,
      }],
    })])
    const wrapper = mountView()
    await flushPromises()
    expect(wrapper.find('input[type="range"]').exists()).toBe(false)
    await actionButton(wrapper.get('article'), 'enable').trigger('click')
    await flushPromises()
    expect(enablePlugin).toHaveBeenCalledWith(8, 100, false)
    expect(stepUpRun).toHaveBeenCalledTimes(1)
  })

  it('遥测异常但 binding 启用时仍可停用且不可卸载', async () => {
    listPlugins.mockResolvedValue([telemetryPlugin({
      state: 'error',
      bindings: [{
        id: 2, plugin_id: 8, capability: 'sub2api.user_telemetry.read.v1',
        platform: 'sub2api', account_type: 'user', enabled: true, rollout_percent: 100,
      }],
    })])
    const wrapper = mountView()
    await flushPromises()
    const card = wrapper.get('article')
    expect(actionButton(card, 'disable').attributes('disabled')).toBeUndefined()
    expect(actionButton(card, 'uninstall').attributes('disabled')).toBeDefined()
    expect(card.find('input[type="range"]').exists()).toBe(false)
  })

  it('启动中的遥测不允许重复启用或卸载', async () => {
    listPlugins.mockResolvedValue([telemetryPlugin({ state: 'starting' })])
    const wrapper = mountView()
    await flushPromises()
    const card = wrapper.get('article')
    expect(actionButton(card, 'enable').attributes('disabled')).toBeDefined()
    expect(actionButton(card, 'uninstall').attributes('disabled')).toBeDefined()
    await actionButton(card, 'enable').trigger('click')
    await actionButton(card, 'uninstall').trigger('click')
    expect(enablePlugin).not.toHaveBeenCalled()
    expect(removePlugin).not.toHaveBeenCalled()
  })

  it.each(['enabled', 'error', 'disabled'] as const)('遥测与传输共存，传输保留 binding/灰度语义（%s）', async (state) => {
    const bindingEnabled = state !== 'disabled'
    const transport: PluginInstallation = {
      ...structuredClone(plugin), state,
      bindings: [{ ...plugin.bindings[0], enabled: bindingEnabled, rollout_percent: 35 }],
    }
    listPlugins.mockResolvedValue([telemetryPlugin({ state: 'enabled' }), transport])
    const wrapper = mountView()
    await flushPromises()
    const [telemetryCard, transportCard] = wrapper.findAll('article')
    expect(telemetryCard.find('input[type="range"]').exists()).toBe(false)
    expect(actionButton(telemetryCard, 'disable').attributes('disabled')).toBeUndefined()
    const range = transportCard.get<HTMLInputElement>('input[type="range"]')
    expect(range.element.value).toBe('35')
    expect(range.element.disabled).toBe(bindingEnabled)
    expect(actionButton(transportCard, 'uninstall').attributes('disabled') !== undefined).toBe(bindingEnabled)
    if (bindingEnabled) {
      const confirm = vi.spyOn(window, 'confirm').mockReturnValue(true)
      await actionButton(transportCard, 'disable').trigger('click')
      await flushPromises()
      expect(confirm).toHaveBeenCalledWith('admin.plugins.confirmDisable')
      expect(disablePlugin).toHaveBeenCalledWith(7)
      expect(enablePlugin).not.toHaveBeenCalled()
    } else {
      await range.setValue('42')
      await actionButton(transportCard, 'enable').trigger('click')
      await flushPromises()
      expect(enablePlugin).toHaveBeenCalledWith(7, 42, false)
      expect(disablePlugin).not.toHaveBeenCalled()
    }
    expect(stepUpRun).toHaveBeenCalledTimes(1)
  })

  it.each(['en', 'zh'] as const)('使用 %s 实际文案说明两类能力及用户只读范围', async (locale) => {
    testLocale.value = locale
    listPlugins.mockResolvedValue([telemetryPlugin({ state: 'enabled' }), plugin])
    const wrapper = mountView()
    await flushPromises()
    const [telemetryCard, transportCard] = wrapper.findAll('article')
    const messages = locale === 'en' ? en.plugins : zh.plugins
    expect(wrapper.text()).toContain(messages.description)
    expect(wrapper.text()).toContain(messages.supportedCapabilities)
    expect(wrapper.text()).toContain(messages.noAccountCoupling)
    expect(telemetryCard.text()).toContain(messages.userTelemetry)
    expect(telemetryCard.text()).toContain(messages.telemetryScope)
    expect(telemetryCard.text()).toContain(messages.disable)
    expect(transportCard.text()).toContain(messages.rollout)
    expect(transportCard.text()).not.toContain(messages.telemetryScope)
    expect(wrapper.text()).not.toContain('admin.plugins.')
    if (locale === 'en') {
      expect(messages.noAccountCoupling).toContain('administrator-approved user allowlist')
      expect(messages.telemetryScope).toContain('does not forward requests or expose API Key plaintext')
      expect(messages.telemetryScope).toContain('percentages do not apply')
    } else {
      expect(messages.noAccountCoupling).toContain('管理员批准的用户白名单')
      expect(messages.telemetryScope).toContain('不转发请求，不暴露 API Key 明文')
      expect(messages.telemetryScope).toContain('不适用 OAuth 流量比例')
    }
  })
})
