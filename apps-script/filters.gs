const SHEET_NAME = 'Transactions';
const FILTERED_COLUMN_COUNT = 13;
const CONTROLS = [
  { cell: 'P1', column: 'M' },
  { cell: 'R1', column: 'F' },
  { cell: 'T1', column: 'B' },
  { cell: 'V1', column: 'G', kind: 'review' },
  { cell: 'X1', column: 'H' },
];

function onOpen() {
  applyFilters_();
}

function onEdit(e) {
  const range = e.range;
  if (range.getSheet().getName() !== SHEET_NAME || range.getRow() !== 1) {
    return;
  }
  if (!CONTROLS.some((control) => control.cell === range.getA1Notation())) {
    return;
  }
  applyFilters_();
}

function applyFilters_() {
  const sheet = SpreadsheetApp.getActive().getSheetByName(SHEET_NAME);
  if (!sheet) {
    return;
  }
  const filter = sheet.getFilter() || sheet.getRange(1, 1, sheet.getMaxRows(), FILTERED_COLUMN_COUNT).createFilter();
  CONTROLS.forEach((control) => {
    const value = String(sheet.getRange(control.cell).getDisplayValue()).trim();
    const columnIndex = sheet.getRange(control.column + '1').getColumn();
    if (!value || value === 'All') {
      filter.removeColumnFilterCriteria(columnIndex);
      return;
    }
    const criteria = SpreadsheetApp.newFilterCriteria().whenFormulaSatisfied(criteriaFormula_(control, value)).build();
    filter.setColumnFilterCriteria(columnIndex, criteria);
  });
}

function criteriaFormula_(control, value) {
  const cell = '$' + control.column + '2';
  if (control.kind === 'review') {
    return value === 'Needs review' ? '=' + cell + '=TRUE' : '=' + cell + '<>TRUE';
  }
  return '=LOWER(' + cell + ')=LOWER("' + value.replace(/"/g, '""') + '")';
}
