import { Agent } from '@theia/ai-core/lib/common/agent';
import { ChatAgent, ChatAgentLocation } from '@theia/ai-chat/lib/common/chat-agents';
import { MutableChatRequestModel, TextChatResponseContentImpl } from '@theia/ai-chat/lib/common/chat-model';
import { ContainerModule, decorate, injectable } from '@theia/core/shared/inversify';
import { FrontendApplicationContribution } from '@theia/core/lib/browser/frontend-application-contribution';
import type { FrontendApplication } from '@theia/core/lib/browser/frontend-application';
import { FrontendApplicationStateService } from '@theia/core/lib/browser/frontend-application-state';
import { CorePreferences } from '@theia/core/lib/common/core-preferences';
import { MAIN_AREA_CLASS } from '@theia/core/lib/browser/shell/application-shell';
import { TheiaDockPanel } from '@theia/core/lib/browser/shell/theia-dock-panel';
import { Widget, type DockPanel } from '@theia/core/lib/browser/widgets/widget';
import { CommandRegistry } from '@theia/core/lib/common/command';
import { EditorPreviewManager } from '@theia/editor-preview/lib/browser/editor-preview-manager';
import { constrainMainEditorPanelOptions, isMainEditorPanelOptions, createPreviewAutoRevealPreference, hasVisualizableSourceEditor } from './fixed-editor-panel-policy.mjs';

// Dedicated Preview container: never nest the visualization beneath Inspector.
const PREVIEW_CONTAINER_WIDGET_ID = 'plugin-view-container:workbench.view.extension.skillStudioPreview';
const PREVIEW_VIEW_ID = 'skillStudio.preview';
const PREVIEW_WIDGET_ID = 'plugin-view:skillStudio.preview';

const AI_WORKBENCH_VIEW = 'skillStudio.aiAuthoring';
const STUDIO_CHAT_AGENT = Symbol('StudioChatAgent');

function isAiWorkbench(widget: Widget | undefined) {
    return (widget as (Widget & { viewType?: string }) | undefined)?.viewType === AI_WORKBENCH_VIEW;
}

class StudioEditorManager extends EditorPreviewManager {
    protected override updateCurrentEditor(): void {
        if (isAiWorkbench(this.shell.getCurrentWidget('main'))) {
            // Theia normally keeps the last native editor as current. Keeping
            // it here suppresses the event when the same editor is revealed
            // again, leaving the VS Code-compatible visible editors stale.
            this.setCurrentEditor(undefined);
            return;
        }
        super.updateCurrentEditor();
    }
}
decorate(injectable(), StudioEditorManager);

interface StudioAgentResult {
    summary?: string;
    compilerState?: string;
    canApply?: boolean;
    cancelled?: boolean;
    error?: string;
}

function createStudioChatAgent(commands: CommandRegistry): ChatAgent {
    return {
        id: 'SkillStudio',
        name: 'SkillStudio',
        description: 'Propose and check a change to the active Skill Procedure. Studio confirms disclosure and owns Apply and Undo.',
        locations: [ChatAgentLocation.Panel],
        variables: [], prompts: [], languageModelRequirements: [], agentSpecificVariables: [], functions: [],
        async invoke(request: MutableChatRequestModel) {
            const id = crypto.randomUUID();
            const response = request.response;
            const token = response.cancellationToken;
            const task = request.request.text.replace(/^\s*@SkillStudio(?=\s|$)\s*/, '').trim();
            if (token.isCancellationRequested) return;
            const cancellation = token.onCancellationRequested(() => {
                void commands.executeCommand('skillStudio.internal.cancelNativeAgent', id).catch(() => undefined);
            });
            try {
                response.addProgressMessage({ content: '正在读取当前 Procedure，检查发送范围。' });
                const result = await commands.executeCommand<StudioAgentResult>('skillStudio.internal.runNativeAgent', id, task);
                if (token.isCancellationRequested || result?.cancelled) return;
                if (!result?.summary) {
                    response.response.addContent(new TextChatResponseContentImpl(result?.error || 'Studio 没有返回候选。'));
                } else {
                    response.response.addContent(new TextChatResponseContentImpl(
                        result.summary + '\n\nCompiler Check · ' + (result.compilerState || 'UNAVAILABLE') +
                        '\n\n点击顶部 AI Workbench 查看 Change Set 和 Diff。' +
                        (result.canApply ? '审阅确认后可应用到当前文件。' : '当前候选仅供审阅。')
                    ));
                }
                response.complete();
            } finally {
                cancellation.dispose();
            }
        }
    };
}

function addWorkspaceModeControl(app: FrontendApplication, commands: CommandRegistry) {
    const shell = app.shell;
    const control = new Widget({ node: document.createElement('nav') });
    control.id = 'skill-studio-workspace-mode';
    control.node.setAttribute('aria-label', 'Skill Studio mode');
    Object.assign(control.node.style, {
        display: 'flex', flexWrap: 'wrap', gap: '4px', alignItems: 'center', padding: '3px 8px',
        background: 'var(--theia-titleBar-activeBackground)'
    });
    const modes = [
        { title: 'AI Workbench', command: 'skillStudio.openAiAuthoring' },
        { title: 'Console', command: 'skillStudio.openConsole' }
    ];
    const buttons = modes.map(({ title, command }) => {
        const button = document.createElement('button');
        button.type = 'button';
        button.textContent = title;
        Object.assign(button.style, {
            font: 'inherit', padding: '3px 10px', cursor: 'pointer',
            color: 'var(--theia-button-secondaryForeground)', border: '1px solid transparent',
            borderRadius: '3px'
        });
        button.onclick = async () => {
            buttons.forEach(item => { item.disabled = true; });
            try {
                await commands.executeCommand(command);
            } catch (error) {
                console.warn('Skill Studio mode could not be opened:', error);
            } finally {
                buttons.forEach(item => { item.disabled = false; });
                update();
            }
        };
        control.node.appendChild(button);
        return button;
    });
    const chat = document.createElement('button');
    chat.type = 'button';
    chat.textContent = 'AI Chat';
    chat.onclick = () => { void commands.executeCommand('aiChat:toggle'); };
    control.node.appendChild(chat);
    // The static preview places this notice in the document before startup.
    // Give it space in the toolbar so it never overlaps the Chat composer.
    const previewNotice = document.getElementById('skill-studio-preview-warning');
    if (previewNotice) control.node.appendChild(previewNotice);
    const update = () => {
        const current = shell.getCurrentWidget('main');
        const active = isAiWorkbench(current) ? 0 :
            current && current.title.label !== 'SKILL Studio Welcome' ? 1 : -1;
        buttons.forEach((button, index) => {
            button.setAttribute('aria-pressed', String(index === active));
            button.style.background = index === active
                ? 'var(--theia-button-secondaryBackground)' : 'transparent';
        });
    };
    const changed = shell.onDidChangeCurrentWidget(update);
    void shell.addWidget(control, { area: 'top' });
    update();
    return { dispose() { changed.dispose(); control.dispose(); } };
}

export default new ContainerModule((bind, unbind, isBound, rebind) => {
    rebind(EditorPreviewManager).to(StudioEditorManager).inSingletonScope();
    bind<ChatAgent>(STUDIO_CHAT_AGENT).toDynamicValue(({ container }) =>
        createStudioChatAgent(container.get(CommandRegistry))).inSingletonScope();
    bind(Agent).toService(STUDIO_CHAT_AGENT);
    bind(ChatAgent).toService(STUDIO_CHAT_AGENT);

    // Theia does not expose VS Code's generated workbench.view.extension.*
    // commands through its extension host. Reveal the contributed secondary
    // sidebar through ApplicationShell instead, so the Preview WebviewView
    // can resolve on both backend and browser-only Theia.
    bind(FrontendApplicationContribution).toDynamicValue(({ container }) => {
        const state = container.get(FrontendApplicationStateService);
        const commands = container.get(CommandRegistry);
        let stopped = false;
        let added: { dispose(): void } | undefined;
        let changed: { dispose(): void } | undefined;
        let modeControl: { dispose(): void } | undefined;
        return {
            onStart(app: FrontendApplication) {
                const shell = app.shell;
                modeControl = addWorkspaceModeControl(app, commands);
                let storage: Storage | undefined;
                try {
                    // sessionStorage belongs to this browser tab. A global
                    // localStorage marker suppressed the Preview in new tabs
                    // after another tab had already opened Markdown.
                    storage = window.sessionStorage;
                } catch {
                    // Browser profiles can disallow persistent storage.
                }
                // Each workspace has its own restored layout. Reset first
                // reveal for another workspace without clearing the current
                // tab's intentional hide/resize choice.
                const autoReveal = createPreviewAutoRevealPreference(storage, window.location.hash);
                let revealInFlight = false;
                let selectingPreview = false;
                let lastSourceWidgetId = '';
                let attempts = 0;
                let lastOutcome = 'not-attempted';
                const getStatus = () => {
                    const container = shell.getWidgetById(PREVIEW_CONTAINER_WIDGET_ID);
                    return {
                        attempts,
                        lastOutcome,
                        autoRevealPending: autoReveal.shouldReveal(),
                        sourceVisible: hasVisualizableSourceEditor(shell.getWidgets('main')),
                        sourceWidgetId: shell.getCurrentWidget('main')?.id ?? null,
                        containerExists: !!container,
                        containerVisible: !!container?.isVisible,
                        previewViewExists: !!shell.getWidgetById(PREVIEW_WIDGET_ID),
                        previewViewVisible: !!shell.getWidgetById(PREVIEW_WIDGET_ID)?.isVisible,
                        rightExpanded: shell.isExpanded('right'),
                        appState: state.state
                    };
                };
                // This diagnostic is read by real Chromium acceptance after an
                // actual Source open; it never alters layout or editor state.
                (window as unknown as {
                    __skillStudioPreviewActivation?: () => ReturnType<typeof getStatus>;
                }).__skillStudioPreviewActivation = getStatus;
                const openNestedPreview = async () => {
                    // Theia plugin view commands are registered on the Core
                    // CommandRegistry. Avoid importing plugin-ext internals:
                    // its browser-only and backend bundles resolve differently.
                    if (shell.getWidgetById(PREVIEW_WIDGET_ID)) {
                        return shell.revealWidget(PREVIEW_WIDGET_ID);
                    }
                    const openCommand = PREVIEW_VIEW_ID + '.open';
                    if (!commands.getCommand(openCommand)) return undefined;
                    await commands.executeCommand(openCommand);
                    return shell.getWidgetById(PREVIEW_WIDGET_ID);
                };
                const revealView = () => {
                    if (stopped || selectingPreview) return;
                    selectingPreview = true;
                    // Selecting the Inspector container is not enough: it may
                    // contain an expanded Inspector and a collapsed Preview.
                    // Theia's PluginViewRegistry opens the exact contributed
                    // WebviewView without allocating a second EditorGroup.
                    void openNestedPreview()
                        .catch(error => console.warn('SKILL Studio Preview view could not be revealed:', error))
                        .finally(() => { selectingPreview = false; });
                };
                const reveal = () => {
                    // First-run Welcome does not open a Source document. Marking
                    // the Preview as auto-revealed before the Example workspace
                    // reload caused Theia to restore a hidden right sidebar on
                    // the second page load and skip Preview activation forever.
                    if (stopped || !autoReveal.shouldReveal() || revealInFlight ||
                        !hasVisualizableSourceEditor(shell.getWidgets('main'))) {
                        return;
                    }
                    const container = shell.getWidgetById(PREVIEW_CONTAINER_WIDGET_ID);
                    if (!container) {
                        lastOutcome = 'waiting-for-preview-container';
                        return;
                    }
                    revealInFlight = true;
                    attempts++;
                    lastOutcome = 'revealing';
                    try {
                        // revealWidget selects the right-hand widget without
                        // stealing focus from the native Source editor. Unlike
                        // activateWidget, it does not require the WebviewView
                        // content itself to accept focus.
                        shell.expandPanel('right');
                        void shell.revealWidget(PREVIEW_CONTAINER_WIDGET_ID)
                            .then(async revealed => {
                                if (stopped || !revealed) return;
                                const preview = await openNestedPreview();
                                if (stopped) return;
                                const visible = !!preview && container.isVisible &&
                                    shell.isExpanded('right') &&
                                    !!shell.getWidgetById(PREVIEW_WIDGET_ID)?.isVisible;
                                lastOutcome = visible ? 'visible' : 'still-hidden';
                                if (!visible) return;
                                // Persist success only after a real Source and
                                // the Preview container are both visible.
                                autoReveal.markRevealed();
                                const width = container.node.getBoundingClientRect().width;
                                if (width > 0 && width < 400 && window.innerWidth >= 1050) {
                                    shell.resize(Math.min(620, Math.round(window.innerWidth * 0.43)), 'right');
                                }
                            })
                            .catch(error => {
                                lastOutcome = 'error: ' + String(error);
                                console.warn('SKILL Studio Preview could not be revealed:', error);
                            })
                            .finally(() => {
                                revealInFlight = false;
                            });
                    } catch (error) {
                        revealInFlight = false;
                        lastOutcome = 'error: ' + String(error);
                        console.warn('SKILL Studio Preview could not be revealed:', error);
                    }
                };
                // Theia restores its shell before the Example is imported.
                // Listen for Source widgets after that handoff, not just for
                // the creation of the Preview container on the Welcome page.
                const ready = state.reachedState('ready');
                let lastNativeSourceUri = '';
                const sourceChanged = () => {
                    const current = shell.getCurrentWidget('main');
                    if (isAiWorkbench(current)) {
                        lastNativeSourceUri = '';
                        return;
                    }
                    const sourceWidget = current as (Widget & {
                        editor?: { uri?: { toString(): string } };
                        resource?: { toString(): string };
                    }) | undefined;
                    const rawSourceUri = sourceWidget?.editor?.uri ?? sourceWidget?.resource;
                    const sourceUri = typeof rawSourceUri?.toString === 'function'
                        ? rawSourceUri.toString() : '';
                    if (sourceUri && sourceUri !== lastNativeSourceUri) {
                        lastNativeSourceUri = sourceUri;
                        void commands.executeCommand('skillStudio.internal.nativeSourceActivated', sourceUri)
                            .then(accepted => {
                                if (accepted !== true && lastNativeSourceUri === sourceUri) {
                                    lastNativeSourceUri = '';
                                }
                            })
                            .catch(error => {
                                if (lastNativeSourceUri === sourceUri) lastNativeSourceUri = '';
                                console.warn('SKILL Studio native Source state could not be synchronized:', error);
                            });
                    }
                    if (!current || !hasVisualizableSourceEditor([current])) return;
                    if (current.id === lastSourceWidgetId) return;
                    lastSourceWidgetId = current.id;
                    if (autoReveal.shouldReveal()) {
                        reveal();
                    } else if (shell.isExpanded('right')) {
                        // The user may have the Inspector subview selected.
                        // Follow each new YAML/Markdown Source with the actual
                        // Preview subview, but never reopen a deliberately
                        // collapsed Secondary Sidebar.
                        revealView();
                    }
                };
                added = shell.onDidAddWidget(widget => {
                    if (widget.id === PREVIEW_CONTAINER_WIDGET_ID) {
                        void ready.then(() => {
                            reveal();
                            sourceChanged();
                        });
                    } else if (!!(widget as { editor?: unknown }).editor) {
                        void ready.then(sourceChanged);
                    }
                });
                changed = shell.onDidChangeCurrentWidget(() => {
                    void ready.then(sourceChanged);
                });
                void ready.then(() => {
                    reveal();
                    sourceChanged();
                });
            },
            onStop() {
                stopped = true;
                added?.dispose();
                changed?.dispose();
                modeControl?.dispose();
            }
        };
    }).inSingletonScope();

    // Product invariant: one native Main Editor group, with a dedicated
    // contextual Preview in the right secondary sidebar. Enforce this for
    // normal Pages and backend-backed hosts, not only acceptance URLs.
    if (!isBound(TheiaDockPanel.Factory)) {
        throw new Error('TheiaDockPanel.Factory is not bound; fixed editor layout cannot be installed.');
    }

    rebind(TheiaDockPanel.Factory).toFactory(({ container }) => (
        options?: DockPanel.IOptions | TheiaDockPanel.IOptions,
        maximizeCallback?: (area: TheiaDockPanel) => void
    ) => {
        const isMainEditor = isMainEditorPanelOptions(options, MAIN_AREA_CLASS);
        const effectiveOptions = constrainMainEditorPanelOptions(options, MAIN_AREA_CLASS);
        const panel = new TheiaDockPanel(
            effectiveOptions,
            container.get(CorePreferences),
            maximizeCallback
        );

        if (isMainEditor) {
            panel.addClass('skill-studio-fixed-editor-group');
            panel.node.dataset.skillStudioEditorMode = 'single-document';
            (window as unknown as {
                __skillStudioFixedEditorLayout?: () => {
                    mode: string;
                    tabBarCount: number;
                    widgetCount: number;
                };
            }).__skillStudioFixedEditorLayout = () => ({
                mode: panel.mode,
                tabBarCount: Array.from(panel.tabBars()).length,
                widgetCount: Array.from(panel.widgets()).length
            });
        }

        return panel;
    });
});
