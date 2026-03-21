import assert from 'node:assert/strict';
import test from 'node:test';
// @ts-expect-error Browser helper lives in public/ and is loaded directly at runtime.
import { toggleHiddenAttribute } from '../../public/dashboard/toggle-hidden-attribute.js';

class FakeElement {
  private readonly attributes = new Set<string>();

  hasAttribute(name: string): boolean {
    return this.attributes.has(name);
  }

  toggleAttribute(name: string, force?: boolean): boolean {
    if (force ?? !this.attributes.has(name)) {
      this.attributes.add(name);
      return true;
    }

    this.attributes.delete(name);
    return false;
  }
}

test('toggleHiddenAttribute writes the real hidden attribute for SVG-like elements', () => {
  const element = new FakeElement();

  toggleHiddenAttribute(element as never, true);
  assert.equal(element.hasAttribute('hidden'), true);

  toggleHiddenAttribute(element as never, false);
  assert.equal(element.hasAttribute('hidden'), false);
});
