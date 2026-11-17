import '@testing-library/jest-dom';

// JSDOM does not implement HTML5 validity.badInput for <input type="date">.
// Polyfill it so jsdom mirrors real browser behavior when invalid dates are set.
const origDescriptor = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value');
if (origDescriptor) {
  const origSet = origDescriptor.set;
  Object.defineProperty(HTMLInputElement.prototype, 'value', {
    ...origDescriptor,
    set(val: string) {
      if (this.type === 'date') {
        const strVal = String(val);
        const isValid = (dStr: string) => {
          if (!/^\d{4}-\d{2}-\d{2}$/.test(dStr)) return false;
          const [y, m, d] = dStr.split('-').map(Number);
          if (m < 1 || m > 12 || d < 1 || d > 31) return false;
          const dt = new Date(y, m - 1, d);
          return dt.getFullYear() === y && dt.getMonth() === m - 1 && dt.getDate() === d;
        };
        (this as any)._badDateInput = strVal !== '' && !isValid(strVal);
      }
      return origSet?.call(this, val);
    },
  });

  const origValidityDesc = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'validity');
  if (origValidityDesc) {
    const origValidityGet = origValidityDesc.get;
    Object.defineProperty(HTMLInputElement.prototype, 'validity', {
      ...origValidityDesc,
      get() {
        const validity = origValidityGet?.call(this);
        if (this.type === 'date' && (this as any)._badDateInput) {
          return new Proxy(validity, {
            get(target, prop) {
              if (prop === 'badInput') return true;
              if (prop === 'valid') return false;
              return Reflect.get(target, prop);
            },
          });
        }
        return validity;
      },
    });
  }
}
