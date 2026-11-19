import { ContainerModule } from '@theia/core/shared/inversify';
import { FrontendApplicationContribution } from '@theia/core/lib/browser/frontend-application-contribution';
import type { FrontendApplication } from '@theia/core/lib/browser/frontend-application';
import { FrontendApplicationStateService } from '@theia/core/lib/browser/frontend-application-state';
import { CorePreferences } from '@theia/core/lib/common/core-preferences';
import { MAIN_AREA_CLASS } from '@theia/core/lib/browser/shell/application-shell';
import { TheiaDockPanel } from '@theia/core/lib/browser/shell/theia-dock-panel';
import type { DockPanel } from '@lumino/widgets';
import { constrainMainEditorPanelOptions, isMainEditorPanelOptions } from './fixed-editor-panel-policy.mjs';

const FIXED_LAYOUT_TEST_QUERY = 'skillStudioFixedLayoutTest';
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
                const reveal = () => {
                    if (stopped || !shell.getWidgetById(PREVIEW_CONTAINER_WIDGET_ID)) {
                        return;
                    }
                    shell.expandPanel('right');
                    void shell.activateWidget(PREVIEW_CONTAINER_WIDGET_ID).then(() => {
                        if (stopped) return;
                        // The stock Secondary Sidebar defaults to ~227px, which
                        // cannot display a readable React Flow canvas. Only grow
                        // cramped initial layouts; preserve user-resized widths.
                        const preview = shell.getWidgetById(PREVIEW_CONTAINER_WIDGET_ID);
                        const width = preview?.node?.getBoundingClientRect().width ?? 0;
                        if (width > 0 && width < 400 && window.innerWidth >= 1050) {
                            shell.resize(Math.min(620, Math.round(window.innerWidth * 0.43)), 'right');
                        }
                    }).catch(error => {
                        console.warn('SKILL Studio Preview container could not be activated:', error);
                    });
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

    // Keep the Main Editor DockPanel override test-gated until all real
    // Chromium acceptance cases have verified the one-group invariant.
    const enabled = typeof window !== 'undefined' &&
        new URLSearchParams(window.location.search).get(FIXED_LAYOUT_TEST_QUERY) === '1';
    if (!enabled) {
        return;
    }

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
