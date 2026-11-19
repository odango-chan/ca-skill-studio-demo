import { ContainerModule } from '@theia/core/shared/inversify';
import { FrontendApplicationContribution } from '@theia/core/lib/browser/frontend-application-contribution';
import type { FrontendApplication } from '@theia/core/lib/browser/frontend-application';
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
    bind(FrontendApplicationContribution).toDynamicValue(() => ({
        onStart(app: FrontendApplication) {
            const shell = app.shell;
            let stopped = false;
            const reveal = () => {
                if (stopped || !shell.getWidgetById(PREVIEW_CONTAINER_WIDGET_ID)) {
                    return;
                }
                shell.expandPanel('right');
                void shell.activateWidget(PREVIEW_CONTAINER_WIDGET_ID).catch(error => {
                    console.warn('SKILL Studio Preview container could not be activated:', error);
                });
            };
            const scheduleReveal = () => {
                // onStart precedes shell attachment; defer activation until
                // the frontend startup continuation has attached the shell.
                window.setTimeout(reveal, 0);
            };
            const added = shell.onDidAddWidget(widget => {
                if (widget.id === PREVIEW_CONTAINER_WIDGET_ID) {
                    scheduleReveal();
                }
            });
            scheduleReveal();
            return {
                onStop() {
                    stopped = true;
                    added.dispose();
                }
            };
        }
    })).inSingletonScope();

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
