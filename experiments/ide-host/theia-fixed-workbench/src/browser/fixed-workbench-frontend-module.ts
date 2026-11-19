import { ContainerModule } from '@theia/core/shared/inversify';
import { CorePreferences } from '@theia/core/lib/common/core-preferences';
import { MAIN_AREA_CLASS } from '@theia/core/lib/browser/shell/application-shell';
import { TheiaDockPanel } from '@theia/core/lib/browser/shell/theia-dock-panel';
import type { DockPanel } from '@lumino/widgets';
import { constrainMainEditorPanelOptions, isMainEditorPanelOptions } from './fixed-editor-panel-policy.mjs';

const FIXED_LAYOUT_TEST_QUERY = 'skillStudioFixedLayoutTest';

export default new ContainerModule((bind, unbind, isBound, rebind) => {
    // Keep the current production workbench unchanged until all visualizers
    // have migrated into the shared Preview WebviewView. The exact same
    // integration is enabled by the isolated Chromium acceptance URL.
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
