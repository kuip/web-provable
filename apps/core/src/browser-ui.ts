import type { AppFieldDefinition, AppReleaseManifest } from "./contracts";
import { parseMarkdownTemplate, type MarkdownInline } from "./markdown";

export type BrowserFormField = HTMLInputElement | HTMLTextAreaElement | HTMLOutputElement;

export interface BrowserMarkdownFormOptions {
  actionLabels: Readonly<Record<string, string>>;
  inputPlaceholders?: Readonly<Record<string, string>>;
  multilineTextFields?: readonly string[];
}

export interface BrowserMarkdownForm {
  actions: ReadonlyMap<string, HTMLButtonElement>;
  fields: ReadonlyMap<string, BrowserFormField>;
  form: HTMLFormElement;
}

/** Renders the inert app Markdown contract into controlled browser form elements. */
export function renderBrowserMarkdownForm(
  markdown: string,
  manifest: AppReleaseManifest,
  options: BrowserMarkdownFormOptions,
): BrowserMarkdownForm {
  const definitions = new Map(manifest.fields.map((field) => [field.id, field]));
  const fields = new Map<string, BrowserFormField>();
  const actions = new Map<string, HTMLButtonElement>();
  const multilineFields = new Set(options.multilineTextFields ?? []);
  const form = document.createElement("form");

  for (const block of parseMarkdownTemplate(markdown)) {
    if (block.kind === "heading") {
      const heading = document.createElement(`h${block.level}`);
      appendInline(heading, block.children, definitions, fields);
      form.append(heading);
      continue;
    }
    if (block.kind === "paragraph") {
      const paragraph = document.createElement("p");
      appendInline(paragraph, block.children, definitions, fields);
      form.append(paragraph);
      continue;
    }
    if (block.kind === "field") {
      const definition = requireDefinition(definitions, block.id);
      markField(definition, fields);
      form.append(renderField(
        definition,
        fields,
        multilineFields,
        options.inputPlaceholders ?? {},
      ));
      continue;
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
    form.append(button);
  }

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
