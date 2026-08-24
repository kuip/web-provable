import type { AppFieldDefinition, AppReleaseManifest } from "./contracts";
import {
  parseMarkdownTabs,
  type MarkdownContentBlock,
  type MarkdownHeadingLevel,
  type MarkdownInline,
} from "./markdown";

export type BrowserFormField = HTMLInputElement | HTMLTextAreaElement | HTMLOutputElement;

export interface BrowserMarkdownFormOptions {
  actionLabels: Readonly<Record<string, string>>;
  documentationFooter?: HTMLElement;
  inputPlaceholders?: Readonly<Record<string, string>>;
  multilineTextFields?: readonly string[];
}

export interface BrowserMarkdownForm {
  actions: ReadonlyMap<string, HTMLButtonElement>;
  fields: ReadonlyMap<string, BrowserFormField>;
  form: HTMLFormElement;
}

interface DocumentationHeading {
  element: HTMLHeadingElement;
  level: MarkdownHeadingLevel;
  parent: DocumentationHeading | undefined;
  title: string;
}

interface DocumentationNavigation {
  element: HTMLElement;
  refresh: () => void;
}

let formSequence = 0;

/** Renders the inert, tabbed app Markdown contract into controlled browser form elements. */
export function renderBrowserMarkdownForm(
  markdown: string,
  manifest: AppReleaseManifest,
  options: BrowserMarkdownFormOptions,
): BrowserMarkdownForm {
  const definitions = new Map(manifest.fields.map((field) => [field.id, field]));
  const fields = new Map<string, BrowserFormField>();
  const actions = new Map<string, HTMLButtonElement>();
  const multilineFields = new Set(options.multilineTextFields ?? []);
  const tabs = parseMarkdownTabs(markdown);
  const formId = `provable-markdown-${++formSequence}`;
  const form = document.createElement("form");
  form.className = "markdown-tabs";

  const stickyHeader = document.createElement("div");
  stickyHeader.className = "markdown-tabs-sticky";
  const tabList = document.createElement("div");
  tabList.className = "markdown-tab-list";
  tabList.setAttribute("role", "tablist");
  tabList.setAttribute("aria-label", `${manifest.title} tabs`);
  stickyHeader.append(tabList);

  const tabButtons: HTMLButtonElement[] = [];
  const tabPanels: HTMLElement[] = [];
  const documentationHeadings: DocumentationHeading[] = [];
  const usedHeadingIds = new Set<string>();
  const documentationTabIndex = tabs.length - 1;

  for (const [index, tab] of tabs.entries()) {
    const isDocumentationTab = index === documentationTabIndex;
    const tabButton = document.createElement("button");
    tabButton.id = `${formId}-tab-${index}`;
    tabButton.className = "markdown-tab";
    tabButton.type = "button";
    tabButton.setAttribute("role", "tab");
    tabButton.setAttribute("aria-controls", `${formId}-panel-${index}`);
    if (isDocumentationTab) {
      tabButton.classList.add("documentation-tab");
      tabButton.setAttribute("aria-label", tab.title);
      const icon = document.createElement("span");
      icon.className = "documentation-tab-icon";
      icon.setAttribute("aria-hidden", "true");
      icon.textContent = "📖";
      tabButton.append(icon);
    } else {
      tabButton.textContent = tab.title;
    }
    tabList.append(tabButton);
    tabButtons.push(tabButton);

    const panel = document.createElement("section");
    panel.id = `${formId}-panel-${index}`;
    panel.className = "markdown-tab-panel";
    panel.setAttribute("role", "tabpanel");
    panel.setAttribute("aria-labelledby", tabButton.id);
    if (isDocumentationTab) {
      panel.classList.add("documentation-panel");
    }
    for (const block of tab.blocks) {
      panel.append(renderBlock(
        block,
        definitions,
        fields,
        actions,
        multilineFields,
        options,
        isDocumentationTab ? documentationHeadings : undefined,
        formId,
        usedHeadingIds,
      ));
    }
    if (isDocumentationTab && options.documentationFooter) {
      options.documentationFooter.hidden = false;
      panel.append(options.documentationFooter);
    }
    tabPanels.push(panel);
  }

  const documentationNavigation = createDocumentationNavigation(
    documentationHeadings,
    `${formId}-documentation`,
  );
  if (documentationNavigation) {
    documentationNavigation.element.hidden = true;
    stickyHeader.append(documentationNavigation.element);
  }
  form.append(stickyHeader, ...tabPanels);

  const activateTab = (index: number, moveFocus: boolean): void => {
    for (const [tabIndex, button] of tabButtons.entries()) {
      const active = tabIndex === index;
      button.setAttribute("aria-selected", String(active));
      button.tabIndex = active ? 0 : -1;
      const panel = tabPanels[tabIndex];
      if (panel) {
        panel.hidden = !active;
      }
    }
    if (documentationNavigation) {
      documentationNavigation.element.hidden = index !== documentationTabIndex;
      if (index === documentationTabIndex) {
        documentationNavigation.refresh();
      }
    }
    if (moveFocus) {
      tabButtons[index]?.focus();
    }
  };

  for (const [index, button] of tabButtons.entries()) {
    button.addEventListener("click", () => activateTab(index, false));
    button.addEventListener("keydown", (event) => {
      const nextIndex = keyboardTabIndex(event.key, index, tabButtons.length);
      if (nextIndex === undefined) {
        return;
      }
      event.preventDefault();
      activateTab(nextIndex, true);
    });
  }
  activateTab(0, false);

  for (const definition of manifest.fields) {
    if (!fields.has(definition.id)) {
      throw new Error(`UI template is missing declared field: ${definition.id}`);
    }
  }
  for (const action of Object.keys(options.actionLabels)) {
    if (!actions.has(action)) {
      throw new Error(`UI template is missing the ${action} action`);
    }
  }

  return { actions, fields, form };
}

/** Keeps sticky app content immediately below a platform header of dynamic height. */
export function observeBrowserHeaderHeight(
  header: HTMLElement,
  cssVariable = "--provable-shell-header-height",
): () => void {
  const update = (): void => {
    document.documentElement.style.setProperty(
      cssVariable,
      `${Math.ceil(header.getBoundingClientRect().height)}px`,
    );
  };
  update();

  if (typeof ResizeObserver === "undefined") {
    window.addEventListener("resize", update, { passive: true });
    return () => window.removeEventListener("resize", update);
  }

  const observer = new ResizeObserver(update);
  observer.observe(header);
  return () => observer.disconnect();
}

function renderBlock(
  block: MarkdownContentBlock,
  definitions: Map<string, AppFieldDefinition>,
  fields: Map<string, BrowserFormField>,
  actions: Map<string, HTMLButtonElement>,
  multilineFields: Set<string>,
  options: BrowserMarkdownFormOptions,
  documentationHeadings: DocumentationHeading[] | undefined,
  headingPrefix: string,
  usedHeadingIds: Set<string>,
): HTMLElement {
  if (block.kind === "heading") {
    const heading = document.createElement(`h${block.level}`) as HTMLHeadingElement;
    appendInline(heading, block.children, definitions, fields);
    if (documentationHeadings && block.level >= 2) {
      const title = heading.textContent?.trim() ?? "";
      if (title.length === 0) {
        throw new Error("Documentation headings must have text");
      }
      heading.id = uniqueHeadingId(headingPrefix, title, usedHeadingIds);
      heading.classList.add("documentation-heading");
      documentationHeadings.push({
        element: heading,
        level: block.level,
        parent: undefined,
        title,
      });
    }
    return heading;
  }
  if (block.kind === "paragraph") {
    const paragraph = document.createElement("p");
    appendInline(paragraph, block.children, definitions, fields);
    return paragraph;
  }
  if (block.kind === "field") {
    const definition = requireDefinition(definitions, block.id);
    markField(definition, fields);
    return renderField(
      definition,
      fields,
      multilineFields,
      options.inputPlaceholders ?? {},
    );
  }

  const label = options.actionLabels[block.id];
  if (label === undefined || actions.has(block.id)) {
    throw new Error(`Unsupported or duplicate app action: ${block.id}`);
  }
  const button = document.createElement("button");
  button.id = `action-${block.id}`;
  button.type = "submit";
  button.textContent = label;
  actions.set(block.id, button);
  return button;
}

function createDocumentationNavigation(
  headings: DocumentationHeading[],
  idPrefix: string,
): DocumentationNavigation | undefined {
  if (headings.length === 0) {
    return undefined;
  }

  const stack: DocumentationHeading[] = [];
  for (const heading of headings) {
    while ((stack.at(-1)?.level ?? 0) >= heading.level) {
      stack.pop();
    }
    heading.parent = stack.at(-1);
    stack.push(heading);
  }

  const navigation = document.createElement("nav");
  navigation.className = "documentation-navigation";
  navigation.setAttribute("aria-label", "Documentation navigation");
  const controls = document.createElement("div");
  controls.className = "documentation-navigation-controls";
  navigation.append(controls);

  const levels = [...new Set(headings.map((heading) => heading.level))].sort(
    (left, right) => left - right,
  );
  const selectors = new Map<MarkdownHeadingLevel, {
    field: HTMLElement;
    select: HTMLSelectElement;
  }>();

  for (const level of levels) {
    const field = document.createElement("div");
    field.className = "documentation-navigation-field";
    const select = document.createElement("select");
    select.id = `${idPrefix}-level-${level}`;
    select.setAttribute("aria-label", headingLevelLabel(level));
    select.addEventListener("change", () => {
      const target = headings.find((heading) => heading.element.id === select.value);
      target?.element.scrollIntoView({ behavior: "smooth", block: "start" });
    });
    field.append(select);
    controls.append(field);
    selectors.set(level, { field, select });
  }

  let activeHeadingId = "";
  let animationFrame = 0;

  const scheduleUpdate = (): void => {
    if (animationFrame !== 0 || navigation.hidden) {
      return;
    }
    animationFrame = requestAnimationFrame(() => {
      animationFrame = 0;
      updateCurrentHeading();
    });
  };

  const refresh = (): void => {
    activeHeadingId = "";
    scheduleUpdate();
  };

  const updateCurrentHeading = (): void => {
    const viewportMiddle = window.innerHeight / 2;
    let active = headings[0];
    for (const heading of headings) {
      if (heading.element.getBoundingClientRect().top > viewportMiddle) {
        break;
      }
      active = heading;
    }
    if (!active || active.element.id === activeHeadingId) {
      return;
    }
    activeHeadingId = active.element.id;
    updateDocumentationSelectors(headings, selectors, active);
  };

  document.addEventListener("scroll", scheduleUpdate, { capture: true, passive: true });
  window.addEventListener("scroll", scheduleUpdate, { passive: true });
  window.addEventListener("resize", scheduleUpdate, { passive: true });

  return { element: navigation, refresh };
}

function updateDocumentationSelectors(
  headings: DocumentationHeading[],
  selectors: Map<MarkdownHeadingLevel, { field: HTMLElement; select: HTMLSelectElement }>,
  active: DocumentationHeading,
): void {
  const activePath: DocumentationHeading[] = [];
  let pathItem: DocumentationHeading | undefined = active;
  while (pathItem) {
    activePath.unshift(pathItem);
    pathItem = pathItem.parent;
  }

  for (const [level, selector] of selectors) {
    const context = activePath.filter((heading) => heading.level < level).at(-1);
    const candidates = headings.filter((heading) => (
      heading.level === level && (!context || isDescendantOf(heading, context))
    ));
    selector.field.hidden = candidates.length === 0;
    if (candidates.length === 0) {
      continue;
    }

    const placeholder = document.createElement("option");
    placeholder.value = "";
    placeholder.textContent = "";
    placeholder.disabled = true;
    const options = candidates.map((heading) => {
      const option = document.createElement("option");
      option.value = heading.element.id;
      option.textContent = heading.title;
      return option;
    });
    selector.select.replaceChildren(placeholder, ...options);
    selector.select.value = activePath.find((heading) => heading.level === level)?.element.id ?? "";
  }
}

function isDescendantOf(
  heading: DocumentationHeading,
  possibleAncestor: DocumentationHeading,
): boolean {
  let parent = heading.parent;
  while (parent) {
    if (parent === possibleAncestor) {
      return true;
    }
    parent = parent.parent;
  }
  return false;
}

function headingLevelLabel(level: MarkdownHeadingLevel): string {
  if (level === 2) {
    return "Chapter";
  }
  if (level === 3) {
    return "Subchapter";
  }
  if (level === 4) {
    return "Subsubchapter";
  }
  return `Level ${level}`;
}

function keyboardTabIndex(
  key: string,
  currentIndex: number,
  tabCount: number,
): number | undefined {
  if (key === "ArrowLeft") {
    return (currentIndex - 1 + tabCount) % tabCount;
  }
  if (key === "ArrowRight") {
    return (currentIndex + 1) % tabCount;
  }
  if (key === "Home") {
    return 0;
  }
  if (key === "End") {
    return tabCount - 1;
  }
  return undefined;
}

function uniqueHeadingId(prefix: string, title: string, usedIds: Set<string>): string {
  const slug = title
    .normalize("NFKD")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "") || "section";
  let id = `${prefix}-${slug}`;
  let suffix = 2;
  while (usedIds.has(id)) {
    id = `${prefix}-${slug}-${suffix++}`;
  }
  usedIds.add(id);
  return id;
}

function renderField(
  definition: AppFieldDefinition,
  fields: Map<string, BrowserFormField>,
  multilineFields: Set<string>,
  placeholders: Readonly<Record<string, string>>,
): HTMLElement {
  if (definition.role === "output") {
    const wrapper = document.createElement("div");
    wrapper.className = "output-field";
    wrapper.dataset.field = definition.id;

    const label = document.createElement("span");
    label.textContent = definition.label;
    const output = createOutput(definition.id);
    fields.set(definition.id, output);
    wrapper.append(label, output);
    return wrapper;
  }

  const wrapper = document.createElement("div");
  wrapper.className = "field-group";
  const label = document.createElement("label");
  label.htmlFor = `field-${definition.id}`;
  label.textContent = definition.label;
  wrapper.append(label);

  let control: HTMLInputElement | HTMLTextAreaElement;
  if (definition.type === "proof" || multilineFields.has(definition.id)) {
    const textarea = document.createElement("textarea");
    textarea.rows = definition.type === "proof" ? 4 : 7;
    control = textarea;
  } else {
    const input = document.createElement("input");
    input.type = definition.type === "integer"
      ? "number"
      : definition.type === "boolean"
        ? "checkbox"
        : "text";
    if (definition.type === "integer") {
      input.min = "0";
      input.step = "1";
    }
    control = input;
  }

  control.id = `field-${definition.id}`;
  control.name = definition.id;
  control.required = definition.required === true;
  control.placeholder = placeholders[definition.id] ?? "";
  if (definition.default !== undefined) {
    if (control instanceof HTMLInputElement && control.type === "checkbox") {
      control.checked = Boolean(definition.default);
    } else {
      control.value = String(definition.default);
    }
  }
  fields.set(definition.id, control);
  wrapper.append(control);
  return wrapper;
}

function appendInline(
  parent: HTMLElement,
  children: MarkdownInline[],
  definitions: Map<string, AppFieldDefinition>,
  fields: Map<string, BrowserFormField>,
): void {
  for (const child of children) {
    if (child.kind === "text") {
      parent.append(document.createTextNode(child.value));
    } else if (child.kind === "strong") {
      const strong = document.createElement("strong");
      strong.textContent = child.value;
      parent.append(strong);
    } else if (child.kind === "code") {
      const code = document.createElement("code");
      code.className = "inline-code";
      code.textContent = child.value;
      parent.append(code);
    } else {
      const definition = requireDefinition(definitions, child.id);
      if (definition.role !== "output") {
        throw new Error(`Input field must use a standalone placeholder: ${definition.id}`);
      }
      markField(definition, fields);
      const output = createOutput(definition.id);
      fields.set(definition.id, output);
      parent.append(output);
    }
  }
}

function createOutput(id: string): HTMLOutputElement {
  const output = document.createElement("output");
  output.id = `field-${id}`;
  output.value = "—";
  output.textContent = "—";
  return output;
}

function requireDefinition(
  definitions: Map<string, AppFieldDefinition>,
  id: string,
): AppFieldDefinition {
  const definition = definitions.get(id);
  if (!definition) {
    throw new Error(`UI template references an undeclared field: ${id}`);
  }
  return definition;
}

function markField(
  definition: AppFieldDefinition,
  fields: Map<string, BrowserFormField>,
): void {
  if (fields.has(definition.id)) {
    throw new Error(`UI template renders a field more than once: ${definition.id}`);
  }
}
