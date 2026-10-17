import type { ReadPageFileInputBinding } from '@tabrix/shared';

interface RawFileInputBinding {
  selector?: unknown;
  accept?: unknown;
  multiple?: unknown;
  disabled?: unknown;
  visible?: unknown;
}

const FILE_INPUT_BINDING_CLAIM_BOUNDARY =
  'Read-only DOM evidence proves only that a file input binding candidate exists in this snapshot; it does not prove upload authorization, upload execution, website acceptance, final publish readiness, or business success.';

export async function collectReadPageFileInputBindings(
  tabId: number,
  frameId?: number,
): Promise<ReadPageFileInputBinding[]> {
  try {
    const result = (await chrome.scripting.executeScript({
      target: { tabId, ...(typeof frameId === 'number' ? { frameIds: [frameId] } : {}) },
      world: 'ISOLATED',
      func: () => {
        function cssEscape(value: string): string {
          const escapeFn = (globalThis as { CSS?: { escape?: (input: string) => string } }).CSS
            ?.escape;
          return typeof escapeFn === 'function' ? escapeFn(value) : value.replace(/["\\]/g, '\\$&');
        }

        function selectorForInput(input: HTMLInputElement): string {
          const id = input.getAttribute('id');
          if (id) return `#${cssEscape(id)}`;
          const name = input.getAttribute('name');
          if (name) return `input[type="file"][name="${cssEscape(name)}"]`;
          const inputs = Array.from(document.querySelectorAll('input[type="file"]'));
          const index = inputs.indexOf(input);
          if (index >= 0) return `input[type="file"]:nth-of-type(${index + 1})`;
          return 'input[type="file"]';
        }

        return Array.from(document.querySelectorAll('input[type="file"]'))
          .filter((input): input is HTMLInputElement => input instanceof HTMLInputElement)
          .slice(0, 5)
          .map((input) => {
            const rect = input.getBoundingClientRect();
            const style = window.getComputedStyle(input);
            const visible =
              rect.width > 0 &&
              rect.height > 0 &&
              style.visibility !== 'hidden' &&
              style.display !== 'none';
            return {
              selector: selectorForInput(input),
              accept: input.getAttribute('accept') || undefined,
              multiple: input.multiple,
              disabled: input.disabled,
              visible,
            };
          });
      },
    })) as Array<{ result?: unknown }>;
    const bindings = result?.[0]?.result;
    if (!Array.isArray(bindings)) return [];
    return bindings
      .map((binding: RawFileInputBinding): ReadPageFileInputBinding | null => {
        const selector = typeof binding?.selector === 'string' ? binding.selector.trim() : '';
        if (!selector) return null;
        return {
          selector,
          ...(typeof binding.accept === 'string' && binding.accept.trim()
            ? { accept: binding.accept.trim() }
            : {}),
          ...(typeof binding.multiple === 'boolean' ? { multiple: binding.multiple } : {}),
          ...(typeof binding.disabled === 'boolean' ? { disabled: binding.disabled } : {}),
          ...(typeof binding.visible === 'boolean' ? { visible: binding.visible } : {}),
          bindingSource: 'dom_input_type_file',
          nextRequiredTool: 'chrome_upload_file',
          nextRequiredCheck:
            'run_chrome_upload_file_then_run_fresh_same_tab_read_to_prove_upload_state',
          claimBoundary: FILE_INPUT_BINDING_CLAIM_BOUNDARY,
        };
      })
      .filter((binding): binding is ReadPageFileInputBinding => binding !== null);
  } catch (_error) {
    return [];
  }
}
