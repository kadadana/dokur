import * as vscode from 'vscode';
import type { DockerHub } from './hub';

type Item = vscode.QuickPickItem & {
  action: 'search' | 'again' | 'repository' | 'reference' | 'manual' | 'status';
  reference?: string;
};
type Choice =
  { action: 'repository' | 'reference' | 'manual'; reference: string } | { action: 'back' };
export type ImagePickerUI = {
  create(): vscode.QuickPick<Item>;
  input(options: vscode.InputBoxOptions): Thenable<string | undefined>;
};
const nativeUI: ImagePickerUI = {
  create: () => vscode.window.createQuickPick<Item>(),
  input: (options) => vscode.window.showInputBox(options),
};
const separator = (label: string): Item => ({
  label,
  kind: vscode.QuickPickItemKind.Separator,
  action: 'status',
});
const manual = (): Item => ({
  label: '$(edit) Enter image manually…',
  description: 'Any registry, tag, or digest',
  action: 'manual',
  alwaysShow: true,
});

function showPicker(
  ui: ImagePickerUI,
  setup: (
    picker: vscode.QuickPick<Item>,
    close: (choice?: Choice) => void,
    listen: (subscription: vscode.Disposable) => void,
    isOpen: () => boolean,
  ) => void,
): Promise<Choice | undefined> {
  return new Promise((resolve) => {
    const picker = ui.create();
    const subscriptions: vscode.Disposable[] = [];
    let open = true;
    const close = (choice?: Choice) => {
      if (!open) return;
      open = false;
      subscriptions.forEach((subscription) => subscription.dispose());
      picker.hide();
      picker.dispose();
      resolve(choice);
    };
    picker.ignoreFocusOut = true;
    picker.matchOnDescription = true;
    subscriptions.push(picker.onDidHide(() => close()));
    setup(
      picker,
      close,
      (subscription) => subscriptions.push(subscription),
      () => open,
    );
    picker.show();
  });
}

/** Searches only after Enter; network failures keep the manual option available. */
export async function pickDockerImage(
  hub: Pick<DockerHub, 'search' | 'tags'>,
  current = '',
  ui: ImagePickerUI = nativeUI,
): Promise<string | undefined> {
  let lastQuery = '';
  while (true) {
    const repository = await showPicker(ui, (picker, close, listen, isOpen) => {
      let generation = 0;
      let displayedValue = '';
      const setValue = (value: string) => {
        displayedValue = value;
        picker.value = value;
      };
      const showSearch = (value: string) => {
        generation++;
        picker.busy = false;
        picker.title = 'Docker Hub · Search images';
        picker.placeholder = 'Type an image name, then press Enter to search Docker Hub';
        picker.buttons = [];
        setValue(value);
        const query = value.trim();
        const search: Item = {
          label: `$(search) Search Docker Hub for "${query}"`,
          action: 'search',
          alwaysShow: true,
        };
        const fallback = manual();
        picker.items = [
          ...(query.length >= 2 ? [search] : [separator('Type at least 2 characters to search')]),
          separator('Or enter a full image reference'),
          fallback,
        ];
        picker.activeItems = [query.length >= 2 ? search : fallback];
      };
      listen(
        picker.onDidChangeValue((value) => {
          if (value !== displayedValue) showSearch(value);
        }),
      );
      listen(picker.onDidTriggerButton(() => showSearch(lastQuery)));
      listen(
        picker.onDidAccept(() => {
          const picked = picker.selectedItems[0] ?? picker.activeItems[0];
          if (!picked) return;
          if (picked.action === 'manual') {
            close({ action: 'manual', reference: picker.value.trim() || lastQuery || current });
            return;
          }
          if (picked.action === 'repository') {
            close({ action: 'repository', reference: picked.reference! });
            return;
          }
          if (picked.action === 'again') {
            showSearch(lastQuery);
            return;
          }
          if (picked.action !== 'search' || picker.busy) return;
          const query = picker.value.trim();
          if (query.length < 2) return;
          lastQuery = query;
          const request = ++generation;
          picker.busy = true;
          picker.items = [separator('Searching Docker Hub…'), manual()];
          void (async () => {
            let results: Item[] = [];
            let message = '';
            try {
              results = (await hub.search(query)).map((image) => ({
                label: image.name,
                description: `${image.official ? 'Official · ' : ''}${Intl.NumberFormat('en', { notation: 'compact' }).format(image.pulls)} pulls`,
                detail: image.description,
                action: 'repository',
                reference: image.name,
              }));
              if (!results.length) message = `No Docker Hub results for "${query}"`;
            } catch (error) {
              message = `Docker Hub unavailable: ${(error as Error).message}`;
            }
            if (!isOpen() || request !== generation) return;
            picker.busy = false;
            picker.title = `Docker Hub · Results for "${query}"`;
            picker.placeholder = 'Choose an image, or type a new search and press Enter';
            picker.buttons = [vscode.QuickInputButtons.Back];
            setValue('');
            const fallback = manual();
            picker.items = [
              ...(message ? [separator(message)] : results),
              separator('More options'),
              { label: '$(search) Search again…', action: 'again', alwaysShow: true },
              fallback,
            ];
            picker.activeItems = [results[0] ?? fallback];
          })();
        }),
      );
      showSearch(lastQuery);
    });
    if (!repository) return;
    let choice = repository;
    if (repository.action === 'repository') {
      const name = repository.reference;
      const tag = await showPicker(ui, (picker, close, listen, isOpen) => {
        picker.title = `Docker Hub · ${name} · Choose a tag`;
        picker.placeholder = 'Filter tags, or use the manual option for another tag or registry';
        picker.buttons = [vscode.QuickInputButtons.Back];
        picker.busy = true;
        picker.items = [separator('Loading image tags…'), separator('More options'), manual()];
        listen(picker.onDidTriggerButton(() => close({ action: 'back' })));
        listen(
          picker.onDidAccept(() => {
            const picked = picker.selectedItems[0] ?? picker.activeItems[0];
            if (picked?.action === 'manual')
              close({ action: 'manual', reference: `${name}:${picker.value.trim() || 'latest'}` });
            else if (picked?.action === 'reference')
              close({ action: 'reference', reference: picked.reference! });
          }),
        );
        void (async () => {
          let items: Item[] = [];
          let message = '';
          try {
            const tags = await hub.tags(name);
            items = [...tags]
              .sort((a, b) => Number(b.name === 'latest') - Number(a.name === 'latest'))
              .map((tag) => ({
                label: tag.name,
                description: tag.architectures.join(', '),
                action: 'reference',
                reference: `${name}:${tag.name}`,
              }));
            if (!items.length) message = 'No tags found — enter the full image manually';
          } catch (error) {
            message = `Tags unavailable: ${(error as Error).message}`;
          }
          if (!isOpen()) return;
          picker.busy = false;
          const fallback = manual();
          picker.items = [
            ...(message ? [separator(message)] : items),
            separator('More options'),
            fallback,
          ];
          if (!picker.value) picker.activeItems = [items[0] ?? fallback];
        })();
      });
      if (!tag) return;
      if (tag.action === 'back') continue;
      choice = tag;
    }
    if (choice.action === 'manual') {
      const value = await ui.input({
        title: 'Enter image manually',
        prompt: 'Full image reference, for example nginx:alpine or ghcr.io/acme/api:1.0',
        value: choice.reference,
        ignoreFocusOut: true,
        validateInput: (value) => (value.trim() ? undefined : 'Enter an image reference.'),
      });
      return value?.trim() || undefined;
    }
    if (choice.action === 'reference') return choice.reference;
  }
}
