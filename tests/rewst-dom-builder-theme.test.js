const assert = require('node:assert/strict');
const test = require('node:test');

class FakeClassList {
  constructor(element) {
    this.element = element;
  }

  values() {
    return this.element.className.split(/\s+/).filter(Boolean);
  }

  contains(name) {
    return this.values().includes(name);
  }

  add(...names) {
    this.element.className = [...new Set([...this.values(), ...names])].join(' ');
  }

  remove(...names) {
    this.element.className = this.values().filter((name) => !names.includes(name)).join(' ');
  }
}

class FakeElement {
  constructor(tagName) {
    this.tagName = tagName.toUpperCase();
    this.children = [];
    this.parentElement = null;
    this.className = '';
    this.classList = new FakeClassList(this);
    this.dataset = {};
    this.style = {};
    this.attributes = {};
    this.textContent = '';
    this.value = '';
    this._innerHTML = '';
  }

  appendChild(child) {
    child.parentElement = this;
    this.children.push(child);
    return child;
  }

  addEventListener() {}

  setAttribute(name, value) {
    this.attributes[name] = String(value);
  }

  getAttribute(name) {
    return this.attributes[name] ?? null;
  }

  contains(target) {
    return target === this || this.children.some((child) => child.contains(target));
  }

  matches(selector) {
    if (selector.startsWith('.')) {
      return selector.slice(1).split('.').every((name) => this.classList.contains(name));
    }

    if (selector.startsWith('#')) return this.id === selector.slice(1);

    const tagAndType = selector.match(/^([a-z]+)(?:\[type="([^"]+)"\])?$/i);
    if (tagAndType) {
      return this.tagName === tagAndType[1].toUpperCase()
        && (!tagAndType[2] || this.type === tagAndType[2]);
    }

    return false;
  }

  querySelectorAll(selector) {
    const target = selector.trim().split(/\s+/).at(-1);
    const matches = [];

    for (const child of this.children) {
      if (child.matches(target)) matches.push(child);
      matches.push(...child.querySelectorAll(target));
    }

    return matches;
  }

  querySelector(selector) {
    return this.querySelectorAll(selector)[0] || null;
  }

  closest(selector) {
    let current = this;
    while (current) {
      if (current.matches(selector)) return current;
      current = current.parentElement;
    }
    return null;
  }

  remove() {
    if (!this.parentElement) return;
    this.parentElement.children = this.parentElement.children.filter((child) => child !== this);
    this.parentElement = null;
  }

  focus() {}
  blur() {}

  getBoundingClientRect() {
    return { top: 0, right: 0, bottom: 0, left: 0, width: 0, height: 0 };
  }

  set innerHTML(value) {
    this._innerHTML = value;
    if (value === '') this.children = [];
  }

  get innerHTML() {
    return this._innerHTML;
  }
}

const fakeDocument = {
  body: new FakeElement('body'),
  createElement(tagName) {
    return new FakeElement(tagName);
  },
  addEventListener() {},
  querySelector() {
    return null;
  },
  querySelectorAll(selector) {
    return this.body.querySelectorAll(selector);
  },
};

global.document = fakeDocument;
global.window = { DEBUG_MODE: false };

const RewstDOM = require('../src/rewst-dom-builder.js');

test('autocomplete search uses the shared themed input contract', () => {
  const autocomplete = RewstDOM.createAutocomplete([
    { name: 'Workflow', id: 'workflow-1' },
  ]);
  const input = autocomplete.querySelector('input');

  assert.ok(input, 'autocomplete should render an input');
  assert.equal(input.classList.contains('form-input'), true);
});

test('table search uses the shared themed input contract', () => {
  const table = RewstDOM.createTable(
    [{ name: 'Workflow' }],
    { title: 'Workflows', searchable: true, sortable: false, pagination: false }
  );
  const input = table.querySelector('input');

  assert.ok(input, 'searchable table should render an input');
  assert.equal(input.classList.contains('form-input'), true);
});
