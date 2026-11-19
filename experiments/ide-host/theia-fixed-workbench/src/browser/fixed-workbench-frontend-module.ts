import { ContainerModule } from '@theia/core/shared/inversify';
import { FrontendApplicationContribution } from '@theia/core/lib/browser/frontend-application-contribution';
import type { FrontendApplication } from '@theia/core/lib/browser/frontend-application';
import { FrontendApplicationStateService } from '@theia/core/lib/browser/frontend-application-state';
import { CorePreferences } from '@theia/core/lib/common/core-preferences';
import { MAIN_AREA_CLASS } from '@theia/core/lib/browser/shell/application-shell';
import { TheiaDockPanel } from '@theia/core/lib/browser/shell/theia-dock-panel';
import type { DockPanel } from '@lumino/widgets';
import { CommandRegistry } from '@theia/core/lib/common/command';
import { constrainMainEditorPanelOptions, isMainEditorPanelOptions, createPreviewAutoRevealPreference, hasVisualizableSourceEditor } from './fixed-editor-panel-policy.mjs';

const PREVIEW_CONTAINER_WIDGET_ID = 'plugin-view-container:workbench.view.extension.skillStudioInspector';
const PREVIEW_VIEW_ID = 'skillStudio.preview';
const PREVIEW_WIDGET_ID = 'plugin-view:skillStudio.preview';

export default new ContainerModule((bind, unbind, isBound, rebind) => {
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
        return {
            onStart(app: FrontendApplication) {
                const shell = app.shell;
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
                const sourceChanged = () => {
                    const current = shell.getCurrentWidget('main');
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
