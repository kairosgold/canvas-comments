import {
  App,
  Editor,
  EventRef,
  MarkdownPostProcessorContext,
  MarkdownView,
  Menu,
  Modal,
  Notice,
  Plugin,
  PluginSettingTab,
  Setting,
  TAbstractFile,
  editorInfoField,
  setIcon,
} from "obsidian";
import { StateEffect, StateField, type EditorState } from "@codemirror/state";
import { Decoration, type DecorationSet, EditorView, ViewPlugin } from "@codemirror/view";

type ThreadKind = "canvas" | "text";

interface ThreadComment {
  id: string;
  author?: string;
  text: string;
  createdAt: string;
}

interface BaseThread {
  id: string;
  kind: ThreadKind;
  comments: ThreadComment[];
  resolved: boolean;
  createdAt: string;
  updatedAt: string;
}

interface CanvasThread extends BaseThread {
  kind: "canvas";
  canvasPath: string;
  nodeId: string;
}

interface TextThread extends BaseThread {
  kind: "text";
  filePath: string;
  from: number;
  to: number;
  quote: string;
}

interface PluginSettings {
  showBadges: boolean;
  showPreviewOnHover: boolean;
  clusterZoomThreshold: number;
  clusterRadius: number;
}

interface PluginDataV2 {
  version: 2;
  canvasThreads: Record<string, Record<string, CanvasThread>>;
  textThreads: Record<string, Record<string, TextThread>>;
  settings: PluginSettings;
}

interface LegacyComment {
  text: string;
  createdAt?: string;
  updatedAt?: string;
}

interface LegacyData {
  version?: number;
  comments?: Record<string, Record<string, LegacyComment>>;
  settings?: Partial<PluginSettings> & { authorName?: string };
  canvasThreads?: PluginDataV2["canvasThreads"];
  textThreads?: PluginDataV2["textThreads"];
}

interface CanvasNodeLike {
  id?: string;
  nodeEl?: HTMLElement;
  containerEl?: HTMLElement;
  canvas?: CanvasLike;
  file?: { path?: string };
  getData?: () => { id?: string; file?: string; type?: string };
  render?: () => void | Promise<void>;
}

interface CanvasLike {
  selection?: Set<CanvasNodeLike>;
  nodes?: Map<string, CanvasNodeLike> | CanvasNodeLike[] | Record<string, CanvasNodeLike>;
  view?: CanvasViewLike;
  file?: { path?: string };
  wrapperEl?: HTMLElement;
  canvasEl?: HTMLElement;
  zoom?: number;
}

interface CanvasViewLike {
  canvas?: CanvasLike;
  file?: { path?: string };
  getViewType?: () => string;
}

interface CanvasThreadRef {
  kind: "canvas";
  canvasPath: string;
  nodeId: string;
}

interface TextThreadRef {
  kind: "text";
  filePath: string;
  threadId: string;
  draft?: Pick<TextThread, "from" | "to" | "quote">;
}

type ThreadRef = CanvasThreadRef | TextThreadRef;

interface MarkerLayout {
  key: string;
  x: number;
  y: number;
  count: number;
  refs: CanvasThreadRef[];
  clustered: boolean;
}

const DEFAULT_SETTINGS: PluginSettings = {
  showBadges: true,
  showPreviewOnHover: true,
  clusterZoomThreshold: 0.55,
  clusterRadius: 92,
};

const CANVAS_TEXT_KEY_PREFIX = "canvas-text://";

const EMPTY_DATA: PluginDataV2 = {
  version: 2,
  canvasThreads: {},
  textThreads: {},
  settings: DEFAULT_SETTINGS,
};

function newId(): string {
  return globalThis.crypto?.randomUUID?.() ?? `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
}

function nowIso(): string {
  return new Date().toISOString();
}

function relativeTime(value: string): string {
  const then = new Date(value).getTime();
  const seconds = Math.max(0, Math.floor((Date.now() - then) / 1000));
  if (seconds < 45) return "just now";
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 30) return `${days}d ago`;
  const months = Math.floor(days / 30);
  if (months < 12) return `${months}mo ago`;
  return `${Math.floor(months / 12)}y ago`;
}

export function migrateData(saved: LegacyData | null): { data: PluginDataV2; migrated: boolean } {
  if (saved?.version === 2 && saved.canvasThreads && saved.textThreads) {
    let removedIdentity = Boolean(saved.settings?.authorName);
    for (const threads of [...Object.values(saved.canvasThreads), ...Object.values(saved.textThreads)]) {
      for (const thread of Object.values(threads)) {
        for (const comment of thread.comments) {
          if (comment.author) removedIdentity = true;
          delete comment.author;
        }
      }
    }
    return {
      migrated: removedIdentity,
      data: {
        version: 2,
        canvasThreads: saved.canvasThreads,
        textThreads: saved.textThreads,
        settings: {
          showBadges: saved.settings?.showBadges ?? DEFAULT_SETTINGS.showBadges,
          showPreviewOnHover: saved.settings?.showPreviewOnHover ?? DEFAULT_SETTINGS.showPreviewOnHover,
          clusterZoomThreshold: saved.settings?.clusterZoomThreshold ?? DEFAULT_SETTINGS.clusterZoomThreshold,
          clusterRadius: saved.settings?.clusterRadius ?? DEFAULT_SETTINGS.clusterRadius,
        },
      },
    };
  }

  const data: PluginDataV2 = {
    version: 2,
    canvasThreads: {},
    textThreads: {},
    settings: {
      showBadges: saved?.settings?.showBadges ?? DEFAULT_SETTINGS.showBadges,
      showPreviewOnHover: saved?.settings?.showPreviewOnHover ?? DEFAULT_SETTINGS.showPreviewOnHover,
      clusterZoomThreshold: saved?.settings?.clusterZoomThreshold ?? DEFAULT_SETTINGS.clusterZoomThreshold,
      clusterRadius: saved?.settings?.clusterRadius ?? DEFAULT_SETTINGS.clusterRadius,
    },
  };

  for (const [canvasPath, comments] of Object.entries(saved?.comments ?? {})) {
    data.canvasThreads[canvasPath] = {};
    for (const [nodeId, legacy] of Object.entries(comments)) {
      const createdAt = legacy.createdAt ?? nowIso();
      const updatedAt = legacy.updatedAt ?? createdAt;
      data.canvasThreads[canvasPath][nodeId] = {
        id: newId(),
        kind: "canvas",
        canvasPath,
        nodeId,
        resolved: false,
        createdAt,
        updatedAt,
        comments: [{ id: newId(), text: legacy.text, createdAt }],
      };
    }
  }
  return { data, migrated: true };
}

class ThreadModal extends Modal {
  private submitting = false;

  constructor(app: App, private plugin: CanvasCommentsPlugin, private ref: ThreadRef) {
    super(app);
  }

  onOpen(): void {
    this.modalEl.addClass("canvas-comments-thread-modal");
    this.render();
  }

  render(): void {
    const { contentEl } = this;
    contentEl.empty();
    const thread = this.plugin.getThread(this.ref);
    const header = contentEl.createDiv({ cls: "canvas-comments-thread__header" });
    header.createEl("h2", { text: "Comment" });
    const headerActions = header.createDiv({ cls: "canvas-comments-thread__header-actions" });

    if (thread) {
      const resolveButton = headerActions.createEl("button", {
        cls: "clickable-icon",
        attr: {
          "aria-label": thread.resolved ? "Restore comment" : "Mark as resolved",
          title: thread.resolved ? "Restore comment" : "Mark as resolved",
        },
      });
      setIcon(resolveButton, thread.resolved ? "rotate-ccw" : "circle-check");
      resolveButton.addEventListener("click", async () => {
        await this.plugin.setResolved(this.ref, !thread.resolved);
        this.render();
      });

      const moreButton = headerActions.createEl("button", {
        cls: "clickable-icon",
        attr: { "aria-label": "More options", title: "More options" },
      });
      setIcon(moreButton, "ellipsis");
      moreButton.addEventListener("click", (event) => {
        const menu = new Menu();
        menu.addItem((item) => item.setTitle("Delete thread").setIcon("trash-2").onClick(async () => {
          await this.plugin.deleteThread(this.ref);
          this.close();
        }));
        menu.showAtMouseEvent(event);
      });
    }

    const closeButton = headerActions.createEl("button", {
      cls: "clickable-icon",
      attr: { "aria-label": "Close", title: "Close" },
    });
    setIcon(closeButton, "x");
    closeButton.addEventListener("click", () => this.close());

    if (this.ref.kind === "text") {
      const quote = thread?.kind === "text" ? thread.quote : this.ref.draft?.quote;
      if (quote) contentEl.createDiv({
        cls: "canvas-comments-thread__quote",
        text: quote.length > 240 ? `${quote.slice(0, 237)}…` : quote,
      });
    }

    const list = contentEl.createDiv({ cls: "canvas-comments-thread__list" });
    if (!thread?.comments.length) {
      list.createDiv({ cls: "canvas-comments-thread__empty", text: "Start this comment thread." });
    } else {
      for (const comment of thread.comments) this.renderComment(list, comment);
    }

    if (!thread?.resolved) {
      const composer = contentEl.createDiv({ cls: "canvas-comments-composer" });
      const textarea = composer.createEl("textarea", {
        attr: { "aria-label": "Reply", placeholder: thread ? "Reply…" : "Add a comment…" },
      });
      const send = composer.createEl("button", {
        cls: "canvas-comments-composer__send",
        attr: { "aria-label": "Send comment", title: "Send" },
      });
      setIcon(send, "arrow-up");
      const submit = async (): Promise<void> => {
        const text = textarea.value.trim();
        if (!text || this.submitting) return;
        this.submitting = true;
        await this.plugin.addReply(this.ref, text);
        this.submitting = false;
        this.render();
        window.setTimeout(() => this.contentEl.querySelector("textarea")?.focus(), 0);
      };
      send.addEventListener("click", () => void submit());
      textarea.addEventListener("keydown", (event) => {
        if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) {
          event.preventDefault();
          void submit();
        }
      });
      window.setTimeout(() => textarea.focus(), 0);
    } else {
      contentEl.createDiv({
        cls: "canvas-comments-thread__resolved-note",
        text: "Resolved — use the restore button above or Comment Manager to bring it back.",
      });
    }
  }

  private renderComment(parent: HTMLElement, comment: ThreadComment): void {
    const row = parent.createDiv({ cls: "canvas-comments-comment" });
    const body = row.createDiv({ cls: "canvas-comments-comment__body" });
    const meta = body.createDiv({ cls: "canvas-comments-comment__meta" });
    meta.createSpan({ cls: "canvas-comments-comment__time", text: relativeTime(comment.createdAt) });
    const more = meta.createEl("button", {
      cls: "clickable-icon canvas-comments-comment__more",
      attr: { "aria-label": "Comment options", title: "Comment options" },
    });
    setIcon(more, "ellipsis");
    more.addEventListener("click", (event) => {
      const menu = new Menu();
      menu.addItem((item) => item.setTitle("Delete this comment").setIcon("trash-2").onClick(async () => {
        await this.plugin.deleteReply(this.ref, comment.id);
        if (this.plugin.getThread(this.ref)) this.render();
        else this.close();
      }));
      menu.showAtMouseEvent(event);
    });
    body.createDiv({ cls: "canvas-comments-comment__text", text: comment.text });
  }

  onClose(): void {
    this.contentEl.empty();
  }
}

class ResolvedManagerModal extends Modal {
  constructor(app: App, private plugin: CanvasCommentsPlugin) {
    super(app);
  }

  onOpen(): void {
    this.modalEl.addClass("canvas-comments-manager-modal");
    this.render();
  }

  render(): void {
    this.contentEl.empty();
    const header = this.contentEl.createDiv({ cls: "canvas-comments-manager__header" });
    header.createEl("h2", { text: "Resolved comments" });
    const close = header.createEl("button", { cls: "clickable-icon", attr: { "aria-label": "Close" } });
    setIcon(close, "x");
    close.addEventListener("click", () => this.close());
    const rows = this.plugin.getResolvedThreads();
    if (!rows.length) {
      this.contentEl.createDiv({ cls: "canvas-comments-manager__empty", text: "No resolved comments." });
      return;
    }
    const list = this.contentEl.createDiv({ cls: "canvas-comments-manager__list" });
    for (const { ref, thread, label } of rows) {
      const row = list.createDiv({ cls: "canvas-comments-manager__row" });
      const main = row.createEl("button", { cls: "canvas-comments-manager__main" });
      main.createDiv({ cls: "canvas-comments-manager__label", text: label });
      main.createDiv({ cls: "canvas-comments-manager__preview", text: thread.comments.at(-1)?.text ?? "Empty thread" });
      main.addEventListener("click", () => this.plugin.openThread(ref));
      const restore = row.createEl("button", { cls: "mod-cta", text: "Restore" });
      restore.addEventListener("click", async () => {
        await this.plugin.setResolved(ref, false);
        this.render();
      });
    }
  }

  onClose(): void {
    this.contentEl.empty();
  }
}

class ClusterModal extends Modal {
  constructor(app: App, private plugin: CanvasCommentsPlugin, private refs: CanvasThreadRef[]) {
    super(app);
  }

  onOpen(): void {
    this.modalEl.addClass("canvas-comments-cluster-modal");
    this.contentEl.createEl("h2", { text: `${this.refs.length} commented elements` });
    const list = this.contentEl.createDiv({ cls: "canvas-comments-cluster__list" });
    for (const [index, ref] of this.refs.entries()) {
      const thread = this.plugin.getThread(ref);
      if (!thread) continue;
      const last = thread.comments.at(-1);
      const button = list.createEl("button", { cls: "canvas-comments-cluster__row" });
      const text = button.createDiv({ cls: "canvas-comments-cluster__text" });
      text.createDiv({ cls: "canvas-comments-cluster__label", text: `Element ${index + 1} · ${thread.comments.length} comment${thread.comments.length === 1 ? "" : "s"}` });
      text.createDiv({ cls: "canvas-comments-cluster__preview", text: last?.text ?? "" });
      button.addEventListener("click", () => {
        this.close();
        this.plugin.openThread(ref);
      });
    }
  }

  onClose(): void {
    this.contentEl.empty();
  }
}

class CanvasCommentsSettingTab extends PluginSettingTab {
  constructor(app: App, private plugin: CanvasCommentsPlugin) {
    super(app, plugin);
  }

  display(): void {
    const { containerEl } = this;
    containerEl.empty();
    new Setting(containerEl).setName("Show comment markers").setDesc("Display markers for unresolved Canvas comments.").addToggle((toggle) => toggle
      .setValue(this.plugin.data.settings.showBadges).onChange(async (value) => {
        this.plugin.data.settings.showBadges = value;
        await this.plugin.persist();
        this.plugin.refreshCanvasMarkers();
      }));
    new Setting(containerEl).setName("Rich hover previews").setDesc("Show time and the latest comment when hovering a marker.").addToggle((toggle) => toggle
      .setValue(this.plugin.data.settings.showPreviewOnHover).onChange(async (value) => {
        this.plugin.data.settings.showPreviewOnHover = value;
        await this.plugin.persist();
      }));
    new Setting(containerEl).setName("Cluster below zoom").setDesc("Nearby markers merge when the Canvas is zoomed below this scale.").addSlider((slider) => slider
      .setLimits(0.2, 1, 0.05).setDynamicTooltip().setValue(this.plugin.data.settings.clusterZoomThreshold).onChange(async (value) => {
        this.plugin.data.settings.clusterZoomThreshold = value;
        await this.plugin.persist();
        this.plugin.refreshCanvasMarkers();
      }));
    new Setting(containerEl).setName("Manage resolved comments").setDesc("Restore comments hidden with Mark as resolved.").addButton((button) => button
      .setButtonText("Open manager").onClick(() => this.plugin.openResolvedManager()));
  }
}

export default class CanvasCommentsPlugin extends Plugin {
  data: PluginDataV2 = structuredClone(EMPTY_DATA);
  private markerLayer: HTMLElement | null = null;
  private markerButtons = new Map<string, HTMLButtonElement>();
  private tooltipEl: HTMLElement | null = null;
  private trackedEditors = new Set<EditorView>();
  private refreshTextEffect = StateEffect.define<null>();
  private refreshQueued = false;

  async onload(): Promise<void> {
    const migration = migrateData((await this.loadData()) as LegacyData | null);
    this.data = migration.data;
    if (migration.migrated) await this.persist();
    this.registerCommands();
    this.registerCanvasMenus();
    this.registerEditorComments();
    this.registerVaultEvents();
    this.registerMarkdownPostProcessor((el, ctx) => this.decorateReadingView(el, ctx));
    this.registerDomEvent(document, "click", (event) => this.handleDocumentClick(event));
    this.registerInterval(window.setInterval(() => this.refreshCanvasMarkers(), 180));
    this.addSettingTab(new CanvasCommentsSettingTab(this.app, this));
    const ribbon = this.addRibbonIcon("message-circle", "Manage resolved comments", () => this.openResolvedManager());
    ribbon.addClass("canvas-comments-ribbon");
    this.scheduleRefresh();
  }

  onunload(): void {
    this.removeCanvasLayer();
    this.hideTooltip();
    this.trackedEditors.clear();
  }

  async persist(): Promise<void> {
    await this.saveData(this.data);
  }

  private registerCommands(): void {
    this.addCommand({
      id: "add-comment-to-selection",
      name: "Add comment to selected note text",
      checkCallback: (checking) => {
        const activeEditor = this.app.workspace.activeEditor;
        const editor = activeEditor?.editor;
        const filePath = editor && activeEditor ? this.getEditorFilePath(editor, activeEditor) : null;
        if (!editor || !filePath || !editor.getSelection().trim()) return false;
        if (!checking) this.openTextSelectionThread(editor, filePath);
        return true;
      },
    });
    this.addCommand({
      id: "add-or-open-comment",
      name: "Add or open comment on selected Canvas element",
      checkCallback: (checking) => {
        const target = this.getSelectedCanvasTarget();
        if (!target) return false;
        if (!checking) this.openThread(target);
        return true;
      },
    });
    this.addCommand({
      id: "resolve-selected-comment",
      name: "Mark selected Canvas comment as resolved",
      checkCallback: (checking) => {
        const target = this.getSelectedCanvasTarget();
        const thread = target ? this.getThread(target) : null;
        if (!target || !thread || thread.resolved) return false;
        if (!checking) void this.setResolved(target, true);
        return true;
      },
    });
    this.addCommand({ id: "manage-resolved-comments", name: "Manage resolved comments", callback: () => this.openResolvedManager() });
    this.addCommand({
      id: "toggle-comment-markers",
      name: "Toggle Canvas comment markers",
      callback: async () => {
        this.data.settings.showBadges = !this.data.settings.showBadges;
        await this.persist();
        this.refreshCanvasMarkers();
        new Notice(`Canvas comment markers ${this.data.settings.showBadges ? "shown" : "hidden"}.`);
      },
    });
  }

  private registerCanvasMenus(): void {
    const workspace = this.app.workspace as typeof this.app.workspace & {
      on(name: "canvas:node-menu", callback: (menu: Menu, node: CanvasNodeLike) => void): EventRef;
    };
    this.registerEvent(workspace.on("canvas:node-menu", (menu, node) => {
      const canvasPath = this.getCanvasPathFromNode(node) ?? this.getActiveCanvasContext()?.canvasPath;
      const nodeId = this.getNodeId(node);
      if (!canvasPath || !nodeId) return;
      const ref: CanvasThreadRef = { kind: "canvas", canvasPath, nodeId };
      const thread = this.getThread(ref);
      menu.addItem((item) => item.setTitle(thread ? "Open comment thread" : "Add comment").setIcon("message-circle").onClick(() => this.openThread(ref)));
      if (thread && !thread.resolved) {
        menu.addItem((item) => item.setTitle("Mark comment as resolved").setIcon("circle-check").onClick(() => void this.setResolved(ref, true)));
      } else if (thread?.resolved) {
        menu.addItem((item) => item.setTitle("Restore resolved comment").setIcon("rotate-ccw").onClick(() => void this.setResolved(ref, false)));
      }
    }));
    this.registerEvent(this.app.workspace.on("layout-change", () => this.scheduleRefresh()));
    this.registerEvent(this.app.workspace.on("active-leaf-change", () => this.scheduleRefresh()));
  }

  private registerEditorComments(): void {
    const plugin = this;
    const field = StateField.define<DecorationSet>({
      create(state) { return plugin.buildTextDecorations(state); },
      update(value, transaction) {
        if (transaction.docChanged || transaction.effects.some((effect) => effect.is(plugin.refreshTextEffect))) {
          return plugin.buildTextDecorations(transaction.state);
        }
        return value.map(transaction.changes);
      },
      provide: (source) => EditorView.decorations.from(source),
    });
    const tracker = ViewPlugin.fromClass(class {
      constructor(readonly view: EditorView) { plugin.trackedEditors.add(view); }
      destroy(): void { plugin.trackedEditors.delete(this.view); }
    });
    const interactions = EditorView.domEventHandlers({
      click(event) {
        const mark = (event.target as HTMLElement | null)?.closest<HTMLElement>(".canvas-comments-text-highlight");
        if (!mark) return false;
        const filePath = mark.dataset.filePath;
        const threadId = mark.dataset.threadId;
        if (!filePath || !threadId) return false;
        event.preventDefault();
        plugin.openThread({ kind: "text", filePath, threadId });
        return true;
      },
      mouseover(event) {
        const mark = (event.target as HTMLElement | null)?.closest<HTMLElement>(".canvas-comments-text-highlight");
        if (!mark || !plugin.data.settings.showPreviewOnHover) return false;
        const filePath = mark.dataset.filePath;
        const threadId = mark.dataset.threadId;
        if (filePath && threadId) plugin.showThreadTooltip([{ kind: "text", filePath, threadId }], mark);
        return false;
      },
      mouseout(event) {
        if ((event.target as HTMLElement | null)?.closest(".canvas-comments-text-highlight")) plugin.hideTooltip();
        return false;
      },
    });
    this.registerEditorExtension([field, tracker, interactions]);

    this.registerEvent(this.app.workspace.on("editor-menu", (menu, editor, view) => {
      const quote = editor.getSelection();
      menu.addSeparator();
      if (!quote.trim()) {
        menu.addItem((item) => item
          .setTitle("Select text to add a comment")
          .setIcon("message-square-text")
          .setDisabled(true));
        return;
      }
      const filePath = this.getEditorFilePath(editor, view);
      if (!filePath) return;
      const selection = this.getTextSelection(editor, filePath);
      if (!selection) return;
      menu.addItem((item) => item
        .setTitle(selection.existing ? "Open comment" : "Add comment")
        .setIcon("message-square-text")
        .onClick(() => this.openTextSelectionThread(editor, filePath)));
    }));
  }

  private registerVaultEvents(): void {
    this.registerEvent(this.app.vault.on("rename", (file: TAbstractFile, oldPath: string) => {
      if (oldPath.endsWith(".canvas") && this.data.canvasThreads[oldPath]) {
        const threads = this.data.canvasThreads[oldPath];
        for (const thread of Object.values(threads)) thread.canvasPath = file.path;
        this.data.canvasThreads[file.path] = threads;
        delete this.data.canvasThreads[oldPath];
      }
      if (this.data.textThreads[oldPath]) {
        const threads = this.data.textThreads[oldPath];
        for (const thread of Object.values(threads)) thread.filePath = file.path;
        this.data.textThreads[file.path] = threads;
        delete this.data.textThreads[oldPath];
      }
      for (const [sourceKey, threads] of Object.entries(this.data.textThreads)) {
        const anchor = this.parseCanvasTextKey(sourceKey);
        if (!anchor || anchor.canvasPath !== oldPath) continue;
        const nextKey = this.makeCanvasTextKey(file.path, anchor.nodeId);
        for (const thread of Object.values(threads)) thread.filePath = nextKey;
        this.data.textThreads[nextKey] = { ...(this.data.textThreads[nextKey] ?? {}), ...threads };
        delete this.data.textThreads[sourceKey];
      }
      void this.persist();
      this.refreshAllVisuals();
    }));
    this.registerEvent(this.app.vault.on("delete", (file: TAbstractFile) => {
      delete this.data.canvasThreads[file.path];
      delete this.data.textThreads[file.path];
      for (const sourceKey of Object.keys(this.data.textThreads)) {
        if (this.parseCanvasTextKey(sourceKey)?.canvasPath === file.path) delete this.data.textThreads[sourceKey];
      }
      void this.persist();
      this.refreshAllVisuals();
    }));
  }

  getThread(ref: ThreadRef): CanvasThread | TextThread | null {
    if (ref.kind === "canvas") return this.data.canvasThreads[ref.canvasPath]?.[ref.nodeId] ?? null;
    return this.data.textThreads[ref.filePath]?.[ref.threadId] ?? null;
  }

  private ensureThread(ref: ThreadRef): CanvasThread | TextThread {
    const existing = this.getThread(ref);
    if (existing) return existing;
    const createdAt = nowIso();
    if (ref.kind === "canvas") {
      this.data.canvasThreads[ref.canvasPath] ??= {};
      const thread: CanvasThread = {
        id: newId(), kind: "canvas", canvasPath: ref.canvasPath, nodeId: ref.nodeId,
        comments: [], resolved: false, createdAt, updatedAt: createdAt,
      };
      this.data.canvasThreads[ref.canvasPath][ref.nodeId] = thread;
      return thread;
    }
    if (!ref.draft) throw new Error("Cannot create a text comment without a selection anchor.");
    this.data.textThreads[ref.filePath] ??= {};
    const thread: TextThread = {
      id: ref.threadId, kind: "text", filePath: ref.filePath,
      from: ref.draft.from, to: ref.draft.to, quote: ref.draft.quote,
      comments: [], resolved: false, createdAt, updatedAt: createdAt,
    };
    this.data.textThreads[ref.filePath][ref.threadId] = thread;
    return thread;
  }

  openThread(ref: ThreadRef): void { new ThreadModal(this.app, this, ref).open(); }
  openResolvedManager(): void { new ResolvedManagerModal(this.app, this).open(); }

  async addReply(ref: ThreadRef, text: string): Promise<void> {
    const thread = this.ensureThread(ref);
    const createdAt = nowIso();
    thread.resolved = false;
    thread.comments.push({ id: newId(), text, createdAt });
    thread.updatedAt = createdAt;
    await this.persist();
    this.refreshAllVisuals(thread.kind === "text" ? thread.filePath : undefined);
  }

  async deleteReply(ref: ThreadRef, commentId: string): Promise<void> {
    const thread = this.getThread(ref);
    if (!thread) return;
    thread.comments = thread.comments.filter((comment) => comment.id !== commentId);
    if (!thread.comments.length) {
      await this.deleteThread(ref);
      return;
    }
    thread.updatedAt = nowIso();
    await this.persist();
    this.refreshAllVisuals(thread.kind === "text" ? thread.filePath : undefined);
  }

  async setResolved(ref: ThreadRef, resolved: boolean): Promise<void> {
    const thread = this.getThread(ref);
    if (!thread) return;
    thread.resolved = resolved;
    thread.updatedAt = nowIso();
    await this.persist();
    this.refreshAllVisuals(thread.kind === "text" ? thread.filePath : undefined);
    new Notice(resolved ? "Comment marked as resolved." : "Comment restored.");
  }

  async deleteThread(ref: ThreadRef): Promise<void> {
    if (ref.kind === "canvas") {
      delete this.data.canvasThreads[ref.canvasPath]?.[ref.nodeId];
      if (Object.keys(this.data.canvasThreads[ref.canvasPath] ?? {}).length === 0) delete this.data.canvasThreads[ref.canvasPath];
    } else {
      delete this.data.textThreads[ref.filePath]?.[ref.threadId];
      if (Object.keys(this.data.textThreads[ref.filePath] ?? {}).length === 0) delete this.data.textThreads[ref.filePath];
    }
    await this.persist();
    this.refreshAllVisuals(ref.kind === "text" ? ref.filePath : undefined);
    new Notice("Comment thread deleted.");
  }

  getResolvedThreads(): Array<{ ref: ThreadRef; thread: CanvasThread | TextThread; label: string }> {
    const rows: Array<{ ref: ThreadRef; thread: CanvasThread | TextThread; label: string }> = [];
    for (const [canvasPath, threads] of Object.entries(this.data.canvasThreads)) {
      for (const [nodeId, thread] of Object.entries(threads)) if (thread.resolved) rows.push({
        ref: { kind: "canvas", canvasPath, nodeId }, thread, label: `${canvasPath} · Canvas element`,
      });
    }
    for (const [filePath, threads] of Object.entries(this.data.textThreads)) {
      for (const [threadId, thread] of Object.entries(threads)) if (thread.resolved) rows.push({
        ref: { kind: "text", filePath, threadId }, thread,
        label: `${this.parseCanvasTextKey(filePath)?.canvasPath ?? filePath} · ${this.parseCanvasTextKey(filePath) ? "Canvas text · " : ""}“${thread.quote.slice(0, 64)}${thread.quote.length > 64 ? "…" : ""}”`,
      });
    }
    return rows.sort((a, b) => b.thread.updatedAt.localeCompare(a.thread.updatedAt));
  }

  private getActiveCanvasContext(): { view: CanvasViewLike; canvas: CanvasLike; canvasPath: string } | null {
    const view = this.app.workspace.activeLeaf?.view as unknown as CanvasViewLike | undefined;
    if (!view || view.getViewType?.() !== "canvas" || !view.canvas) return null;
    const canvasPath = view.file?.path ?? view.canvas.view?.file?.path;
    return canvasPath ? { view, canvas: view.canvas, canvasPath } : null;
  }

  private getSelectedCanvasTarget(): CanvasThreadRef | null {
    const context = this.getActiveCanvasContext();
    if (!context) return null;
    const selection = Array.from(context.canvas.selection ?? []);
    if (selection.length !== 1) return null;
    const nodeId = this.getNodeId(selection[0]);
    return nodeId ? { kind: "canvas", canvasPath: context.canvasPath, nodeId } : null;
  }

  private getCanvasPathFromNode(node: CanvasNodeLike): string | null {
    return node.canvas?.view?.file?.path ?? node.canvas?.file?.path ?? null;
  }

  private getNodeId(node: CanvasNodeLike): string | null { return node.id ?? node.getData?.().id ?? null; }

  private collectCanvasNodes(canvas: CanvasLike): CanvasNodeLike[] {
    const nodes = canvas.nodes;
    if (!nodes) return [];
    if (nodes instanceof Map) return Array.from(nodes.values());
    if (Array.isArray(nodes)) return nodes;
    return Object.values(nodes);
  }

  private getCanvasScale(canvas: CanvasLike): number {
    const match = (canvas.canvasEl?.style.transform ?? "").match(/scale\(([-\d.]+)\)/);
    if (match) return Number.parseFloat(match[1]);
    const zoom = canvas.zoom ?? 1;
    return zoom <= 0 ? 2 ** zoom : zoom;
  }

  refreshCanvasMarkers(): void {
    const context = this.getActiveCanvasContext();
    if (!context || !context.canvas.wrapperEl || !this.data.settings.showBadges) {
      this.removeCanvasLayer();
      return;
    }
    this.ensureMarkerLayer(context.canvas.wrapperEl);
    if (!this.markerLayer) return;
    const wrapperRect = context.canvas.wrapperEl.getBoundingClientRect();
    const threads = this.data.canvasThreads[context.canvasPath] ?? {};
    const points: Array<{ x: number; y: number; count: number; ref: CanvasThreadRef }> = [];
    for (const node of this.collectCanvasNodes(context.canvas)) {
      const nodeId = this.getNodeId(node);
      const nodeEl = node.nodeEl ?? node.containerEl;
      const thread = nodeId ? threads[nodeId] : null;
      if (!nodeId || !nodeEl || !thread || thread.resolved || !thread.comments.length) continue;
      const rect = nodeEl.getBoundingClientRect();
      if (rect.right < wrapperRect.left || rect.left > wrapperRect.right || rect.bottom < wrapperRect.top || rect.top > wrapperRect.bottom) continue;
      points.push({ x: rect.right - wrapperRect.left, y: rect.top - wrapperRect.top, count: thread.comments.length, ref: { kind: "canvas", canvasPath: context.canvasPath, nodeId } });
    }
    const layouts = this.getCanvasScale(context.canvas) < this.data.settings.clusterZoomThreshold
      ? this.clusterPoints(points)
      : points.map((point) => ({ key: `node:${point.ref.nodeId}`, x: point.x, y: point.y, count: point.count, refs: [point.ref], clustered: false }));
    this.syncMarkerButtons(layouts);
  }

  private clusterPoints(points: Array<{ x: number; y: number; count: number; ref: CanvasThreadRef }>): MarkerLayout[] {
    const clusters: Array<{ x: number; y: number; count: number; points: typeof points }> = [];
    for (const point of points) {
      let nearest: (typeof clusters)[number] | null = null;
      let nearestDistance = Number.POSITIVE_INFINITY;
      for (const cluster of clusters) {
        const distance = Math.hypot(point.x - cluster.x, point.y - cluster.y);
        if (distance < this.data.settings.clusterRadius && distance < nearestDistance) {
          nearest = cluster;
          nearestDistance = distance;
        }
      }
      if (!nearest) clusters.push({ x: point.x, y: point.y, count: point.count, points: [point] });
      else {
        nearest.points.push(point);
        nearest.count += point.count;
        nearest.x = nearest.points.reduce((sum, item) => sum + item.x, 0) / nearest.points.length;
        nearest.y = nearest.points.reduce((sum, item) => sum + item.y, 0) / nearest.points.length;
      }
    }
    return clusters.map((cluster) => {
      const refs = cluster.points.map((point) => point.ref);
      return {
        key: refs.length === 1 ? `node:${refs[0].nodeId}` : `cluster:${refs.map((ref) => ref.nodeId).sort().join("+")}`,
        x: cluster.x, y: cluster.y, count: cluster.count, refs, clustered: refs.length > 1,
      };
    });
  }

  private ensureMarkerLayer(wrapperEl: HTMLElement): void {
    if (this.markerLayer?.isConnected && this.markerLayer.parentElement === wrapperEl) return;
    this.removeCanvasLayer();
    this.markerLayer = wrapperEl.ownerDocument.createElement("div");
    this.markerLayer.className = "canvas-comments-marker-layer";
    wrapperEl.appendChild(this.markerLayer);
  }

  private syncMarkerButtons(layouts: MarkerLayout[]): void {
    if (!this.markerLayer) return;
    const live = new Set(layouts.map((layout) => layout.key));
    for (const layout of layouts) {
      let button = this.markerButtons.get(layout.key);
      if (!button?.isConnected) {
        button = this.markerLayer.ownerDocument.createElement("button");
        button.type = "button";
        button.className = "canvas-comments-marker";
        this.markerLayer.appendChild(button);
        this.markerButtons.set(layout.key, button);
      }
      button.toggleClass("is-cluster", layout.clustered);
      button.style.left = `${layout.x}px`;
      button.style.top = `${layout.y}px`;
      button.setAttribute("aria-label", `${layout.count} unresolved comment${layout.count === 1 ? "" : "s"}`);
      button.empty();
      if (layout.clustered || layout.count > 1) button.createSpan({ cls: "canvas-comments-marker__count", text: String(layout.count) });
      else {
        const icon = button.createSpan({ cls: "canvas-comments-marker__icon" });
        setIcon(icon, "message-circle");
      }
      button.onclick = (event) => {
        event.preventDefault();
        event.stopPropagation();
        this.hideTooltip();
        if (layout.refs.length === 1) this.openThread(layout.refs[0]);
        else new ClusterModal(this.app, this, layout.refs).open();
      };
      button.onpointerdown = (event) => event.stopPropagation();
      button.onmouseenter = () => {
        if (this.data.settings.showPreviewOnHover) this.showThreadTooltip(layout.refs, button!);
      };
      button.onmouseleave = () => this.hideTooltip();
    }
    for (const [key, button] of this.markerButtons) if (!live.has(key)) {
      button.remove();
      this.markerButtons.delete(key);
    }
  }

  private removeCanvasLayer(): void {
    this.markerLayer?.remove();
    this.markerLayer = null;
    this.markerButtons.clear();
  }

  showThreadTooltip(refs: ThreadRef[], anchor: HTMLElement): void {
    this.hideTooltip();
    const threads = refs.map((ref) => this.getThread(ref)).filter((thread): thread is CanvasThread | TextThread => Boolean(thread));
    if (!threads.length) return;
    const comments = threads.flatMap((thread) => thread.comments).sort((a, b) => b.createdAt.localeCompare(a.createdAt));
    const latest = comments[0];
    const tooltip = anchor.ownerDocument.createElement("div");
    tooltip.className = "canvas-comments-tooltip";
    const row = tooltip.createDiv({ cls: "canvas-comments-tooltip__row" });
    const body = row.createDiv({ cls: "canvas-comments-tooltip__body" });
    const meta = body.createDiv({ cls: "canvas-comments-tooltip__meta" });
    meta.createSpan({ cls: "canvas-comments-tooltip__time", text: relativeTime(latest.createdAt) });
    body.createDiv({ cls: "canvas-comments-tooltip__text", text: latest.text.length > 180 ? `${latest.text.slice(0, 177)}…` : latest.text });
    if (threads.length > 1 || comments.length > 1) tooltip.createDiv({
      cls: "canvas-comments-tooltip__summary",
      text: `${comments.length} comments across ${threads.length} element${threads.length === 1 ? "" : "s"}`,
    });
    anchor.ownerDocument.body.appendChild(tooltip);
    const rect = anchor.getBoundingClientRect();
    const maxLeft = anchor.ownerDocument.documentElement.clientWidth - tooltip.offsetWidth - 12;
    tooltip.style.left = `${Math.max(12, Math.min(rect.left, maxLeft))}px`;
    const above = rect.top - tooltip.offsetHeight - 12;
    tooltip.style.top = `${above > 8 ? above : rect.bottom + 12}px`;
    this.tooltipEl = tooltip;
  }

  hideTooltip(): void {
    this.tooltipEl?.remove();
    this.tooltipEl = null;
  }

  private buildTextDecorations(state: EditorState): DecorationSet {
    const filePath = this.getEditorStateSourceKey(state);
    if (!filePath) return Decoration.none;
    const text = state.doc.toString();
    const ranges = Object.values(this.data.textThreads[filePath] ?? {})
      .filter((thread) => !thread.resolved && thread.comments.length)
      .map((thread) => {
        const anchor = this.resolveTextAnchor(thread, text);
        if (!anchor) return null;
        return Decoration.mark({
          class: "canvas-comments-text-highlight",
          attributes: { "data-file-path": filePath, "data-thread-id": thread.id, "data-comment-count": String(thread.comments.length) },
        }).range(anchor.from, anchor.to);
      })
      .filter((range): range is NonNullable<typeof range> => Boolean(range));
    return Decoration.set(ranges, true);
  }

  private resolveTextAnchor(thread: TextThread, text: string): { from: number; to: number } | null {
    if (thread.from >= 0 && thread.to <= text.length && text.slice(thread.from, thread.to) === thread.quote) return { from: thread.from, to: thread.to };
    let index = text.indexOf(thread.quote);
    if (index < 0) return null;
    let closest = index;
    while (index >= 0) {
      if (Math.abs(index - thread.from) < Math.abs(closest - thread.from)) closest = index;
      index = text.indexOf(thread.quote, index + 1);
    }
    return { from: closest, to: closest + thread.quote.length };
  }

  private getEditorStateSourceKey(state: EditorState): string | null {
    const info = state.field(editorInfoField, false) as { file?: { path?: string }; node?: CanvasNodeLike } | undefined;
    const notePath = info?.file?.path ?? info?.node?.getData?.().file;
    if (notePath && !notePath.endsWith(".canvas")) return notePath;
    const node = info?.node;
    const canvasPath = node ? this.getCanvasPathFromNode(node) : null;
    const nodeId = node ? this.getNodeId(node) : null;
    return canvasPath && nodeId ? this.makeCanvasTextKey(canvasPath, nodeId) : notePath ?? null;
  }

  private getEditorFilePath(editor: Editor, view: MarkdownView | { file?: { path?: string } | null }): string | null {
    const cm = (editor as Editor & { cm?: EditorView }).cm;
    const info = cm?.state.field(editorInfoField, false) as { file?: { path?: string }; node?: CanvasNodeLike } | undefined;
    const notePath = info?.file?.path ?? info?.node?.getData?.().file;
    if (notePath && !notePath.endsWith(".canvas")) return notePath;
    const node = info?.node;
    const canvasPath = node ? this.getCanvasPathFromNode(node) : view?.file?.path?.endsWith(".canvas") ? view.file.path : null;
    const nodeId = node ? this.getNodeId(node) : null;
    if (canvasPath && nodeId) return this.makeCanvasTextKey(canvasPath, nodeId);
    return view?.file?.path ?? notePath ?? null;
  }

  private makeCanvasTextKey(canvasPath: string, nodeId: string): string {
    return `${CANVAS_TEXT_KEY_PREFIX}${encodeURIComponent(canvasPath)}#${encodeURIComponent(nodeId)}`;
  }

  private parseCanvasTextKey(sourceKey: string): { canvasPath: string; nodeId: string } | null {
    if (!sourceKey.startsWith(CANVAS_TEXT_KEY_PREFIX)) return null;
    const encoded = sourceKey.slice(CANVAS_TEXT_KEY_PREFIX.length);
    const separator = encoded.lastIndexOf("#");
    if (separator < 0) return null;
    try {
      return {
        canvasPath: decodeURIComponent(encoded.slice(0, separator)),
        nodeId: decodeURIComponent(encoded.slice(separator + 1)),
      };
    } catch {
      return null;
    }
  }

  private posToOffset(text: string, pos: { line: number; ch: number }): number {
    const lines = text.split("\n");
    let offset = 0;
    for (let line = 0; line < pos.line; line++) offset += (lines[line]?.length ?? 0) + 1;
    return offset + pos.ch;
  }

  private getTextSelection(editor: Editor, filePath: string): {
    from: number;
    to: number;
    quote: string;
    existing: TextThread | null;
  } | null {
    const quote = editor.getSelection();
    if (!quote.trim()) return null;
    const value = editor.getValue();
    const from = this.posToOffset(value, editor.getCursor("from"));
    const to = this.posToOffset(value, editor.getCursor("to"));
    return { from, to, quote, existing: this.findExactTextThread(filePath, from, to, quote) };
  }

  private openTextSelectionThread(editor: Editor, filePath: string): void {
    const selection = this.getTextSelection(editor, filePath);
    if (!selection) {
      new Notice("Select a line, paragraph, or text range first.");
      return;
    }
    if (selection.existing) {
      this.openThread({ kind: "text", filePath, threadId: selection.existing.id });
      return;
    }
    this.openThread({
      kind: "text",
      filePath,
      threadId: newId(),
      draft: { from: selection.from, to: selection.to, quote: selection.quote },
    });
  }

  private findExactTextThread(filePath: string, from: number, to: number, quote: string): TextThread | null {
    return Object.values(this.data.textThreads[filePath] ?? {}).find((thread) => thread.from === from && thread.to === to && thread.quote === quote) ?? null;
  }

  private refreshEditorDecorations(): void {
    for (const view of this.trackedEditors) {
      try { view.dispatch({ effects: this.refreshTextEffect.of(null) }); }
      catch { this.trackedEditors.delete(view); }
    }
  }

  private decorateReadingView(el: HTMLElement, ctx: MarkdownPostProcessorContext): void {
    const threads = Object.values(this.data.textThreads[ctx.sourcePath] ?? {})
      .filter((thread) => !thread.resolved && thread.comments.length)
      .sort((a, b) => b.quote.length - a.quote.length);
    for (const thread of threads) this.highlightRenderedQuote(el, thread);
  }

  private highlightRenderedQuote(root: HTMLElement, thread: TextThread): void {
    if (!thread.quote || root.querySelector(`[data-thread-id="${CSS.escape(thread.id)}"]`)) return;
    const doc = root.ownerDocument;
    const walker = doc.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
      acceptNode(node) {
        const parent = node.parentElement;
        if (!node.textContent || !parent || parent.closest("code, pre, script, style, .canvas-comments-text-highlight")) return NodeFilter.FILTER_REJECT;
        return NodeFilter.FILTER_ACCEPT;
      },
    });
    const nodes: Array<{ node: Text; start: number; end: number }> = [];
    let combined = "";
    let current: Node | null;
    while ((current = walker.nextNode())) {
      const node = current as Text;
      const start = combined.length;
      combined += node.data;
      nodes.push({ node, start, end: combined.length });
    }
    const start = combined.indexOf(thread.quote);
    if (start < 0) return;
    const end = start + thread.quote.length;
    const first = nodes.find((entry) => entry.start <= start && entry.end > start);
    const last = [...nodes].reverse().find((entry) => entry.start < end && entry.end >= end);
    if (!first || !last) return;
    try {
      const range = doc.createRange();
      range.setStart(first.node, start - first.start);
      range.setEnd(last.node, end - last.start);
      const mark = doc.createElement("span");
      mark.className = "canvas-comments-text-highlight";
      mark.dataset.filePath = thread.filePath;
      mark.dataset.threadId = thread.id;
      mark.dataset.commentCount = String(thread.comments.length);
      mark.appendChild(range.extractContents());
      range.insertNode(mark);
    } catch {
      // Complex rendered Markdown structures may not be safely wrappable.
    }
  }

  private handleDocumentClick(event: MouseEvent): void {
    const mark = (event.target as HTMLElement | null)?.closest<HTMLElement>(".markdown-preview-view .canvas-comments-text-highlight");
    const filePath = mark?.dataset.filePath;
    const threadId = mark?.dataset.threadId;
    if (!filePath || !threadId) return;
    event.preventDefault();
    event.stopPropagation();
    this.openThread({ kind: "text", filePath, threadId });
  }

  private refreshAllVisuals(filePath?: string): void {
    this.refreshCanvasMarkers();
    this.refreshEditorDecorations();
    if (filePath) this.rerenderCanvasFileNodes(filePath);
  }

  private rerenderCanvasFileNodes(filePath: string): void {
    const context = this.getActiveCanvasContext();
    if (!context) return;
    for (const node of this.collectCanvasNodes(context.canvas)) if (node.getData?.().file === filePath) void node.render?.();
  }

  private scheduleRefresh(): void {
    if (this.refreshQueued) return;
    this.refreshQueued = true;
    window.setTimeout(() => {
      this.refreshQueued = false;
      this.refreshCanvasMarkers();
      this.refreshEditorDecorations();
    }, 100);
  }
}
