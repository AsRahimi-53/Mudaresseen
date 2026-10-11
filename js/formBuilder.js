import { t } from './translations.js';
import { esc, attr, optionList, toSolarDate } from './utils.js';

function labelText(label) { return typeof label === 'string' ? t(label, label) : label[getLanguageKey()] || label.ps || ''; }
function getLanguageKey() { return document.documentElement.lang === 'fa' ? 'dr' : 'ps'; }
export function formFields(fields, record = {}) {
  return fields.map(field => {
    if (field.type === 'section') return `<div class="form-section ${field.className || ''}"><h3>${esc(labelText(field.label))}</h3>${field.hint ? `<p class="form-hint">${esc(labelText(field.hint))}</p>` : ''}</div>`;
    const key = field.key;
    const value = record[key] ?? field.default ?? '';
    const required = field.required ? 'required' : '';
    const span = field.span ? `span-${field.span}` : '';
    const hint = field.hint ? `<small class="form-hint">${esc(labelText(field.hint))}</small>` : '';
    const label = field.label ? `<span>${esc(labelText(field.label))}${field.required ? '<b class="required-mark">*</b>' : ''}</span>` : '';
    let control = '';
    if (field.type === 'textarea') control = `<textarea name="${attr(key)}" rows="${field.rows || 3}" ${required} placeholder="${attr(field.placeholder ? labelText(field.placeholder) : '')}">${esc(value)}</textarea>`;
    else if (field.type === 'date') control = `<input name="${attr(key)}" type="text" inputmode="numeric" class="solar-date-input" data-solar-date value="${attr(toSolarDate(value))}" ${required} placeholder="${attr(t('solarDatePlaceholder'))}" maxlength="10" pattern="[0-9]{4}-[0-9]{2}-[0-9]{2}">`;
    else if (field.type === 'select' || field.type === 'multi-select') { const opts = typeof field.options === 'function' ? field.options() : (field.options || []); const selectedValues = Array.isArray(value) ? value : [value]; const optionsHtml = optionList(opts, field.type === 'select' ? value : '', field.type === 'select' && field.includeBlank !== false).replace(/<option value="([^"]*)"/g, (match, optionValue) => `${match} ${selectedValues.map(String).includes(String(optionValue)) ? 'selected' : ''}`); control = `<select name="${attr(key)}" ${field.type === 'multi-select' ? 'multiple size="4"' : ''} ${required}>${optionsHtml}</select>${field.type === 'multi-select' ? `<small class="form-hint">${esc(t('select'))}</small>` : ''}`; }
    else if (field.type === 'checkbox') control = `<div class="choice-row"><label class="choice"><input type="checkbox" name="${attr(key)}" ${value ? 'checked' : ''}> <span>${esc(labelText(field.checkLabel || field.label))}</span></label></div>`;
    else if (field.type === 'file') control = `<input name="${attr(key)}" type="file" accept="image/*" class="file-input">${value ? `<input type="hidden" name="${attr(`${key}Existing`)}" value="${attr(value)}">` : ''}`;
    else if (field.type === 'number') control = `<input name="${attr(key)}" type="number" value="${attr(value)}" ${field.min !== undefined ? `min="${field.min}"` : ''} ${field.max !== undefined ? `max="${field.max}"` : ''} ${field.step ? `step="${field.step}"` : ''} ${required} placeholder="${attr(field.placeholder || '')}">`;
    else control = `<input name="${attr(key)}" type="${field.type || 'text'}" value="${attr(value)}" ${required} placeholder="${attr(field.placeholder ? labelText(field.placeholder) : '')}">`;
    return `<label class="field ${span}">${label}${control}${hint}</label>`;
  }).join('');
}
export function formShell(fields, record = {}, options = {}) { return `<form class="form-grid ${options.className || ''}" id="${attr(options.id || 'record-form')}" novalidate>${formFields(fields, record)}${options.actions === false ? '' : `<div class="form-actions"><button type="submit" class="btn primary">✓ ${esc(t('save'))}</button><button type="button" class="btn outline" data-modal-close>${esc(t('cancel'))}</button></div>`}</form>`; }
