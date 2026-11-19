import { ContainerModule } from '@theia/core/shared/inversify';
import { FrontendApplicationContribution } from '@theia/core/lib/browser/frontend-application-contribution';
import type { FrontendApplication } from '@theia/core/lib/browser/frontend-application';
import { FrontendApplicationStateService } from '@theia/core/lib/browser/frontend-application-state';
import { CorePreferences } from '@theia/core/lib/common/core-preferences';
import { MAIN_AREA_CLASS } from '@theia/core/lib/browser/shell/application-shell';
import { TheiaDockPanel } from '@theia/core/lib/browser/shell/theia-dock-panel';
import type { DockPanel } from '@lumino/widgets';
import { constrainMainEditorPanelOptions, isMainEditorPanelOptions, createPreviewAutoRevealPreference } from './fixed-editor-panel-policy.mjs';

const PREVIEW_CONTAINER_WIDGET_ID = 'plugin-view-container:workbench.view.extension.skillStudioInspector';

export default new ContainerModule((bind, unbind, isBound, rebind) => {
    // Theia does not expose VS Code's generated workbench.view.extension.*
    // commands through its extension host. Reveal the contributed secondary
    // sidebar through ApplicationShell instead, so the Preview WebviewView
    // can resolve on both backend and browser-only Theia.
    bind(FrontendApplicationContribution).toDynamicValue(({ container }) => {
        const state = container.get(FrontendApplicationStateService);
        let stopped = false;
        let added: { dispose(): void } | undefined;
        return {
            onStart(app: FrontendApplication) {
                const shell = app.shell;
                let storage: Storage | undefined;
                try {
                    storage = window.localStorage;
                } catch {
                    // The Preview remains usable; only the cross-reload preference
                    // is unavailable in this browser context.
                }
                const autoReveal = createPreviewAutoRevealPreference(storage);
                let revealInFlight = false;
                const reveal = () => {
                    if (stopped || !autoReveal.shouldReveal() || revealInFlight ||
                        !shell.getWidgetById(PREVIEW_CONTAINER_WIDGET_ID)) {
                        return;
                    }
                    revealInFlight = true;
                    try {
                        shell.expandPanel('right');
                        void Promise.resolve(shell.activateWidget(PREVIEW_CONTAINER_WIDGET_ID))
                            .then(() => {
                                if (stopped) return;
                                autoReveal.markRevealed();
                                // The stock Secondary Sidebar defaults to ~227px, which
                                // cannot display a readable React Flow canvas. Only grow
                                // cramped initial layouts; preserve user-resized widths.
                                const preview = shell.getWidgetById(PREVIEW_CONTAINER_WIDGET_ID);
                                const width = preview?.node?.getBoundingClientRect().width ?? 0;
                                if (width > 0 && width < 400 && window.innerWidth >= 1050) {
                                    shell.resize(Math.min(620, Math.round(window.innerWidth * 0.43)), 'right');
                                }
                            })
                            .catch(error => {
                                console.warn('SKILL Studio Preview container could not be activated:', error);
                            })
                            .finally(() => {
                                revealInFlight = false;
                            });
                    } catch (error) {
                        revealInFlight = false;
                        console.warn('SKILL Studio Preview container could not be activated:', error);
                    }
                };
                // Wait until Theia has attached the shell and restored persisted
                // layout; otherwise the restored layout could immediately hide
                // the right panel again.
                const ready = state.reachedState('ready');
                added = shell.onDidAddWidget(widget => {
                    if (widget.id === PREVIEW_CONTAINER_WIDGET_ID) {
                        void ready.then(reveal);
                    }
                });
                void ready.then(reveal);
            },
            onStop() {
                stopped = true;
                added?.dispose();
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
