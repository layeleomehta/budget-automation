import { ACCOUNTS_HEADERS, ACCOUNTS_SHEET } from './accounts';
import { ALL_CATEGORIES, BUDGET_CATEGORIES, INCOME, UNCATEGORIZED } from './categories';
import { LEDGER_HEADERS, TRANSACTIONS_SHEET } from './ledger';
import { SEED_RULES } from './rules';
import type { SheetsClient } from './sheets';

export const RULES_SHEET = 'Rules';
export const MONTH_VIEW_SHEET = 'Month View';

const monthSum = ({ categoryRef }: { categoryRef: string }) =>
  `=SUMIFS(${TRANSACTIONS_SHEET}!$E:$E,${TRANSACTIONS_SHEET}!$F:$F,${categoryRef},${TRANSACTIONS_SHEET}!$A:$A,">="&$B$2,${TRANSACTIONS_SHEET}!$A:$A,"<"&EDATE($B$2,1))`;

const MONTH_VIEW_LIST_RANGE = `'${MONTH_VIEW_SHEET}'!D5`;
const MONTH_VIEW_LIST_HEADERS = ['Date', 'Account', 'Merchant', 'Amount', 'Category', 'Review', 'Status'];
const ALL = 'All';
const REVIEW_OPTIONS = [ALL, 'Needs review', 'Reviewed'];
const STATUS_OPTIONS = [ALL, 'Posted', 'Pending'];
const FILTER_LABEL_COLUMN = 11;
const FILTER_VALUE_COLUMN = 12;
const FILTERS = ['Month', 'Category', 'Account', 'Review', 'Status'] as const;
const filterCell = (filter: (typeof FILTERS)[number]) => `$M$${FILTERS.indexOf(filter) + 2}`;
const MONTHS_HELPER = { column: 'O', index: 14 };
const ACCOUNTS_HELPER = { column: 'P', index: 15 };
const MONTH = filterCell('Month');
const MONTH_START_FORMULA = `=IF(ISNUMBER(${MONTH}),DATE(YEAR(${MONTH}),MONTH(${MONTH}),1),DATEVALUE(${MONTH}&"-01"))`;

const monthViewListFormula = () => {
  const t = TRANSACTIONS_SHEET;
  const category = filterCell('Category');
  const account = filterCell('Account');
  const review = filterCell('Review');
  const status = filterCell('Status');
  const columns = ['A', 'B', 'C', 'E', 'F', 'G', 'H'].map((column) => `${t}!${column}:${column}`).join(',');
  const conditions = [
    `ISNUMBER(${t}!A:A)`,
    `${t}!A:A>=$B$2`,
    `${t}!A:A<EDATE($B$2,1)`,
    `(${category}="${ALL}")+(${t}!F:F=${category})`,
    `(${account}="${ALL}")+(${t}!B:B=${account})`,
    `(${review}="${ALL}")+((${review}="Needs review")*(${t}!G:G=TRUE))+((${review}="Reviewed")*(${t}!G:G<>TRUE))`,
    `(${status}="${ALL}")+(${t}!H:H=${status})`,
  ].join(',');
  return `=IFERROR(SORT(FILTER({${columns}},${conditions}),1,FALSE),"No transactions")`;
};

const monthsHelperFormula = () =>
  `=SORT(UNIQUE(FILTER(TEXT(${TRANSACTIONS_SHEET}!A:A,"yyyy-mm"),ISNUMBER(${TRANSACTIONS_SHEET}!A:A))),1,FALSE)`;

const accountsHelperFormula = () =>
  `={"${ALL}";SORT(UNIQUE(FILTER(${TRANSACTIONS_SHEET}!B:B,ISNUMBER(${TRANSACTIONS_SHEET}!A:A))))}`;

const cellRange = ({ column, row, sheetId }: { column: number; row: number; sheetId: number }) => ({
  endColumnIndex: column + 1,
  endRowIndex: row + 1,
  sheetId,
  startColumnIndex: column,
  startRowIndex: row,
});

const filterValueRange = ({ filter, sheetId }: { filter: (typeof FILTERS)[number]; sheetId: number }) =>
  cellRange({ column: FILTER_VALUE_COLUMN, row: FILTERS.indexOf(filter) + 1, sheetId });

const listDropdown = ({ filter, options, sheetId }: { filter: (typeof FILTERS)[number]; options: string[]; sheetId: number }) => ({
  setDataValidation: {
    range: filterValueRange({ filter, sheetId }),
    rule: {
      condition: { type: 'ONE_OF_LIST', values: options.map((option) => ({ userEnteredValue: option })) },
      showCustomUi: true,
      strict: true,
    },
  },
});

const rangeDropdown = ({ filter, helperColumn, sheetId }: { filter: (typeof FILTERS)[number]; helperColumn: string; sheetId: number }) => ({
  setDataValidation: {
    range: filterValueRange({ filter, sheetId }),
    rule: {
      condition: { type: 'ONE_OF_RANGE', values: [{ userEnteredValue: `='${MONTH_VIEW_SHEET}'!$${helperColumn}$2:$${helperColumn}` }] },
      showCustomUi: true,
      strict: false,
    },
  },
});

const columnProperties = ({ hidden, index, pixelSize, sheetId }: { hidden?: boolean; index: number; pixelSize?: number; sheetId: number }) => ({
  updateDimensionProperties: {
    fields: [pixelSize === undefined ? null : 'pixelSize', hidden === undefined ? null : 'hiddenByUser'].filter(Boolean).join(','),
    properties: { ...(hidden === undefined ? {} : { hiddenByUser: hidden }), ...(pixelSize === undefined ? {} : { pixelSize }) },
    range: { dimension: 'COLUMNS', endIndex: index + 1, sheetId, startIndex: index },
  },
});

const styleMonthView = async ({ sheets, sheetId }: { sheetId: number; sheets: SheetsClient }) => {
  const details = await sheets.getSheetDetails(MONTH_VIEW_SHEET);
  const { firstRow, incomeRow, totalRow } = monthViewValues();
  const savingsRow = incomeRow + 1;
  const row = (index: number) => ({ endRowIndex: index, startRowIndex: index - 1 });
  const header = hexColor('#e5e7eb');
  const muted = hexColor('#6b7280');
  const divider = { color: hexColor('#9ca3af'), style: 'SOLID' };
  await sheets.batchUpdate([
    ...(details?.bandedRangeIds ?? []).map((bandedRangeId) => ({ deleteBanding: { bandedRangeId } })),
    {
      repeatCell: {
        cell: { userEnteredFormat: { textFormat: { fontSize: 10 }, verticalAlignment: 'MIDDLE' } },
        fields: 'userEnteredFormat(textFormat.fontSize,verticalAlignment)',
        range: { endColumnIndex: 13, sheetId, startColumnIndex: 0, startRowIndex: 0 },
      },
    },
    {
      repeatCell: {
        cell: { userEnteredFormat: { textFormat: { bold: true, fontSize: 14 } } },
        fields: 'userEnteredFormat(textFormat.bold,textFormat.fontSize)',
        range: { endColumnIndex: 2, sheetId, startColumnIndex: 0, ...row(1) },
      },
    },
    {
      repeatCell: {
        cell: { userEnteredFormat: { textFormat: { bold: false, fontSize: 9, foregroundColor: muted } } },
        fields: 'userEnteredFormat(textFormat.bold,textFormat.fontSize,textFormat.foregroundColor)',
        range: { endColumnIndex: 2, sheetId, startColumnIndex: 0, ...row(2) },
      },
    },
    {
      addBanding: {
        bandedRange: {
          range: { endColumnIndex: 3, endRowIndex: totalRow - 1, sheetId, startColumnIndex: 0, startRowIndex: 3 },
          rowProperties: { firstBandColor: hexColor('#ffffff'), headerColor: header, secondBandColor: hexColor('#f8fafc') },
        },
      },
    },
    {
      addBanding: {
        bandedRange: {
          range: { endColumnIndex: 10, sheetId, startColumnIndex: 3, startRowIndex: 3 },
          rowProperties: { firstBandColor: hexColor('#ffffff'), headerColor: header, secondBandColor: hexColor('#f8fafc') },
        },
      },
    },
    {
      repeatCell: {
        cell: { userEnteredFormat: { textFormat: { bold: true, foregroundColor: hexColor('#111827') } } },
        fields: 'userEnteredFormat(textFormat.bold,textFormat.foregroundColor)',
        range: { endColumnIndex: 10, sheetId, startColumnIndex: 0, ...row(4) },
      },
    },
    {
      repeatCell: {
        cell: { userEnteredFormat: { textFormat: { bold: true } } },
        fields: 'userEnteredFormat.textFormat.bold',
        range: { endColumnIndex: 3, endRowIndex: savingsRow, sheetId, startColumnIndex: 0, startRowIndex: totalRow - 1 },
      },
    },
    {
      updateBorders: {
        range: { endColumnIndex: 3, sheetId, startColumnIndex: 0, ...row(totalRow) },
        top: divider,
      },
    },
    {
      repeatCell: {
        cell: { userEnteredFormat: { backgroundColor: hexColor('#dcfce7'), textFormat: { bold: true, foregroundColor: hexColor('#166534') } } },
        fields: 'userEnteredFormat(backgroundColor,textFormat.bold,textFormat.foregroundColor)',
        range: { endColumnIndex: 3, sheetId, startColumnIndex: 0, ...row(savingsRow) },
      },
    },
    {
      repeatCell: {
        cell: { userEnteredFormat: { horizontalAlignment: 'RIGHT' } },
        fields: 'userEnteredFormat.horizontalAlignment',
        range: { endColumnIndex: 3, endRowIndex: savingsRow, sheetId, startColumnIndex: 1, startRowIndex: 3 },
      },
    },
    {
      repeatCell: {
        cell: { userEnteredFormat: { textFormat: { foregroundColor: muted } } },
        fields: 'userEnteredFormat.textFormat.foregroundColor',
        range: { endColumnIndex: 3, endRowIndex: totalRow, sheetId, startColumnIndex: 2, startRowIndex: firstRow - 1 },
      },
    },
    {
      repeatCell: {
        cell: { userEnteredFormat: { textFormat: { bold: true, fontSize: 11 } } },
        fields: 'userEnteredFormat(textFormat.bold,textFormat.fontSize)',
        range: { endColumnIndex: FILTER_LABEL_COLUMN + 1, endRowIndex: 1, sheetId, startColumnIndex: FILTER_LABEL_COLUMN, startRowIndex: 0 },
      },
    },
    {
      repeatCell: {
        cell: { userEnteredFormat: { horizontalAlignment: 'RIGHT', textFormat: { bold: false, foregroundColor: muted } } },
        fields: 'userEnteredFormat(horizontalAlignment,textFormat.bold,textFormat.foregroundColor)',
        range: { endColumnIndex: FILTER_LABEL_COLUMN + 1, endRowIndex: FILTERS.length + 1, sheetId, startColumnIndex: FILTER_LABEL_COLUMN, startRowIndex: 1 },
      },
    },
    {
      updateBorders: {
        bottom: FILTER_BAR_BORDER,
        innerHorizontal: { color: hexColor('#ffffff'), style: 'SOLID_THICK' },
        left: FILTER_BAR_BORDER,
        range: { endColumnIndex: FILTER_VALUE_COLUMN + 1, endRowIndex: FILTERS.length + 1, sheetId, startColumnIndex: FILTER_VALUE_COLUMN, startRowIndex: 1 },
        right: FILTER_BAR_BORDER,
        top: FILTER_BAR_BORDER,
      },
    },
    columnProperties({ index: 0, pixelSize: 170, sheetId }),
    columnProperties({ index: 1, pixelSize: 110, sheetId }),
    columnProperties({ index: 2, pixelSize: 90, sheetId }),
    columnProperties({ index: 10, pixelSize: 24, sheetId }),
    {
      updateDimensionProperties: {
        fields: 'pixelSize',
        properties: { pixelSize: 26 },
        range: { dimension: 'ROWS', endIndex: savingsRow, sheetId, startIndex: 3 },
      },
    },
  ]);
};

export const setUpMonthViewControls = async ({ sheetId, sheets }: { sheetId: number; sheets: SheetsClient }) => {
  const currentMonth = new Date().toISOString().slice(0, 7);
  await sheets.batchUpdate([
    { setDataValidation: { range: { endColumnIndex: 16, endRowIndex: 1, sheetId, startColumnIndex: 0, startRowIndex: 0 } } },
    {
      repeatCell: {
        cell: { userEnteredFormat: {} },
        fields: 'userEnteredFormat(backgroundColor,numberFormat)',
        range: { endColumnIndex: 16, endRowIndex: 1, sheetId, startColumnIndex: 0, startRowIndex: 0 },
      },
    },
    {
      repeatCell: {
        cell: { userEnteredFormat: { numberFormat: { pattern: '@', type: 'TEXT' } } },
        fields: 'userEnteredFormat.numberFormat',
        range: filterValueRange({ filter: 'Month', sheetId }),
      },
    },
  ]);
  await sheets.updateValues({
    data: [
      { range: `'${MONTH_VIEW_SHEET}'!C1:P1`, values: [Array.from({ length: 14 }, () => '')] },
      { range: `'${MONTH_VIEW_SHEET}'!L1`, values: [['Filters']] },
      { range: `'${MONTH_VIEW_SHEET}'!L2:M6`, values: FILTERS.map((filter) => [filter, filter === 'Month' ? currentMonth : ALL]) },
    ],
    valueInputOption: 'RAW',
  });
  await sheets.updateValues({
    data: [
      { range: `'${MONTH_VIEW_SHEET}'!A1:B2`, values: [['Month', `=${MONTH}`], ['Start', MONTH_START_FORMULA]] },
      { range: `'${MONTH_VIEW_SHEET}'!D4:J4`, values: [MONTH_VIEW_LIST_HEADERS] },
      { range: MONTH_VIEW_LIST_RANGE, values: [[monthViewListFormula()]] },
      { range: `'${MONTH_VIEW_SHEET}'!${MONTHS_HELPER.column}2`, values: [[monthsHelperFormula()]] },
      { range: `'${MONTH_VIEW_SHEET}'!${ACCOUNTS_HELPER.column}2`, values: [[accountsHelperFormula()]] },
    ],
    valueInputOption: 'USER_ENTERED',
  });
  await sheets.batchUpdate([
    rangeDropdown({ filter: 'Month', helperColumn: MONTHS_HELPER.column, sheetId }),
    listDropdown({ filter: 'Category', options: [ALL, ...ALL_CATEGORIES], sheetId }),
    rangeDropdown({ filter: 'Account', helperColumn: ACCOUNTS_HELPER.column, sheetId }),
    listDropdown({ filter: 'Review', options: REVIEW_OPTIONS, sheetId }),
    listDropdown({ filter: 'Status', options: STATUS_OPTIONS, sheetId }),
    {
      repeatCell: {
        cell: { userEnteredFormat: { textFormat: { bold: false } } },
        fields: 'userEnteredFormat.textFormat.bold',
        range: { endColumnIndex: 16, endRowIndex: 1, sheetId, startColumnIndex: 0, startRowIndex: 0 },
      },
    },
    {
      repeatCell: {
        cell: { userEnteredFormat: { textFormat: { bold: true } } },
        fields: 'userEnteredFormat.textFormat.bold',
        range: { endColumnIndex: 1, endRowIndex: 2, sheetId, startColumnIndex: 0, startRowIndex: 0 },
      },
    },
    {
      repeatCell: {
        cell: { userEnteredFormat: { textFormat: { bold: true } } },
        fields: 'userEnteredFormat.textFormat.bold',
        range: { endRowIndex: 4, sheetId, startRowIndex: 3 },
      },
    },
    {
      repeatCell: {
        cell: { userEnteredFormat: { textFormat: { bold: true } } },
        fields: 'userEnteredFormat.textFormat.bold',
        range: { endColumnIndex: FILTER_LABEL_COLUMN + 1, endRowIndex: FILTERS.length + 1, sheetId, startColumnIndex: FILTER_LABEL_COLUMN, startRowIndex: 0 },
      },
    },
    {
      repeatCell: {
        cell: { userEnteredFormat: { backgroundColor: { blue: 0.996, green: 0.949, red: 0.859 } } },
        fields: 'userEnteredFormat.backgroundColor',
        range: { endColumnIndex: FILTER_VALUE_COLUMN + 1, endRowIndex: FILTERS.length + 1, sheetId, startColumnIndex: FILTER_VALUE_COLUMN, startRowIndex: 1 },
      },
    },
    ...[95, 230, 180, 100, 130, 70, 80].map((pixelSize, index) => columnProperties({ index: index + 3, pixelSize, sheetId })),
    columnProperties({ hidden: false, index: FILTER_LABEL_COLUMN, pixelSize: 80, sheetId }),
    columnProperties({ index: FILTER_VALUE_COLUMN, pixelSize: 230, sheetId }),
    columnProperties({ hidden: true, index: MONTHS_HELPER.index, sheetId }),
    columnProperties({ hidden: true, index: ACCOUNTS_HELPER.index, sheetId }),
  ]);
  const { firstRow, incomeRow, rows } = monthViewValues();
  const staleRow = incomeRow + 2;
  await sheets.updateValues({
    data: [...rows, { range: `'${MONTH_VIEW_SHEET}'!A${staleRow}:C${staleRow}`, values: [['', '', '']] }],
    valueInputOption: 'USER_ENTERED',
  });
  await sheets.batchUpdate([
    numberFormat({ endColumn: 3, endRow: incomeRow - 1, pattern: '0.0%', sheetId, startColumn: 2, startRow: firstRow - 1, type: 'PERCENT' }),
    {
      repeatCell: {
        cell: { userEnteredFormat: { horizontalAlignment: 'RIGHT', textFormat: { foregroundColor: hexColor('#6b7280') } } },
        fields: 'userEnteredFormat(horizontalAlignment,textFormat.foregroundColor)',
        range: { endColumnIndex: 3, endRowIndex: incomeRow - 1, sheetId, startColumnIndex: 2, startRowIndex: 3 },
      },
    },
    columnProperties({ index: 2, pixelSize: 90, sheetId }),
    numberFormat({ endColumn: 2, endRow: incomeRow, pattern: '$#,##0.00', sheetId, startColumn: 1, startRow: firstRow - 1, type: 'CURRENCY' }),
    numberFormat({ endColumn: 2, endRow: incomeRow + 1, pattern: '0.0%', sheetId, startColumn: 1, startRow: incomeRow, type: 'PERCENT' }),
    {
      repeatCell: {
        cell: { userEnteredFormat: {} },
        fields: 'userEnteredFormat.numberFormat',
        range: { endColumnIndex: 2, endRowIndex: staleRow, sheetId, startColumnIndex: 0, startRowIndex: staleRow - 1 },
      },
    },
  ]);
  await styleMonthView({ sheetId, sheets });
};

const monthViewValues = () => {
  const summaryCategories = [...BUDGET_CATEGORIES, UNCATEGORIZED];
  const firstRow = 5;
  const lastRow = firstRow + summaryCategories.length - 1;
  const totalRow = lastRow + 1;
  const incomeRow = totalRow + 1;
  return {
    rows: [
      { range: `'${MONTH_VIEW_SHEET}'!A2:B2`, values: [['Start', MONTH_START_FORMULA]] },
      {
        range: `'${MONTH_VIEW_SHEET}'!A4:C${incomeRow + 1}`,
        values: [
          ['Category', 'Amount', '% of spend'],
          ...summaryCategories.map((category, index) => {
            const row = firstRow + index;
            return [category, monthSum({ categoryRef: `$A${row}` }), `=IF($B$${totalRow}>0,B${row}/$B$${totalRow},"")`];
          }),
          ['TOTAL EXPENDITURE', `=SUM(B${firstRow}:B${lastRow})`, `=IF($B$${totalRow}>0,1,"")`],
          ['TOTAL INCOME', `=-${monthSum({ categoryRef: `"${INCOME}"` }).slice(1)}`, ''],
          ['SAVINGS RATE', `=IF(B${incomeRow}>0,1-B${totalRow}/B${incomeRow},"")`, ''],
        ],
      },
    ],
    totalRow,
    incomeRow,
    firstRow,
  };
};

const numberFormat = ({
  endColumn,
  endRow,
  pattern,
  sheetId,
  startColumn,
  startRow,
  type,
}: {
  endColumn: number;
  endRow?: number;
  pattern: string;
  sheetId: number;
  startColumn: number;
  startRow: number;
  type: 'CURRENCY' | 'DATE' | 'PERCENT';
}) => ({
  repeatCell: {
    cell: { userEnteredFormat: { numberFormat: { pattern, type } } },
    fields: 'userEnteredFormat.numberFormat',
    range: { endColumnIndex: endColumn, sheetId, startColumnIndex: startColumn, startRowIndex: startRow, ...(endRow === undefined ? {} : { endRowIndex: endRow }) },
  },
});

const FRIENDLY_DATE = 'mmm d, yyyy';
const CURRENCY = '$#,##0.00;-$#,##0.00';
const TRANSACTIONS_COLUMN_WIDTHS = [105, 230, 180, 280, 100, 130, 70, 80];
const HIDDEN_COLUMNS = { end: LEDGER_HEADERS.length, start: 8 };
const VISIBLE_COLUMN_COUNT = TRANSACTIONS_COLUMN_WIDTHS.length;
const MONTH_COLUMN = { index: LEDGER_HEADERS.length, letter: 'M' };
const FILTERED_COLUMN_COUNT = MONTH_COLUMN.index + 1;
const monthColumnFormula = () =>
  `=ARRAYFORMULA(IF(ROW(A:A)=1,"Month",IF(ISNUMBER(A:A),TEXT(A:A,"yyyy-mm"),"")))`;

const hexColor = (hex: string) => ({
  blue: parseInt(hex.slice(5, 7), 16) / 255,
  green: parseInt(hex.slice(3, 5), 16) / 255,
  red: parseInt(hex.slice(1, 3), 16) / 255,
});

const rowHighlight = ({ background, formula, sheetId, textColor }: { background?: string; formula: string; sheetId: number; textColor?: string }) => ({
  addConditionalFormatRule: {
    index: 0,
    rule: {
      booleanRule: {
        condition: { type: 'CUSTOM_FORMULA', values: [{ userEnteredValue: formula }] },
        format: {
          ...(background ? { backgroundColor: hexColor(background) } : {}),
          ...(textColor ? { textFormat: { foregroundColor: hexColor(textColor) } } : {}),
        },
      },
      ranges: [{ endColumnIndex: VISIBLE_COLUMN_COUNT, sheetId, startColumnIndex: 0, startRowIndex: 1 }],
    },
  },
});

const columnLetter = (index: number) => String.fromCharCode('A'.charCodeAt(0) + index);

export const TRANSACTIONS_FILTER_BAR = [
  { column: 'M', label: 'Month', options: 'months' },
  { column: 'F', label: 'Category', options: [ALL, ...ALL_CATEGORIES] },
  { column: 'B', label: 'Account', options: 'accounts' },
  { column: 'G', label: 'Review', options: REVIEW_OPTIONS },
  { column: 'H', label: 'Status', options: STATUS_OPTIONS },
] as const;
const FILTER_BAR_START = 14;
const FILTER_BAR_HELPERS = { accounts: 25, months: 24 };
const FILTER_BAR_BORDER = { color: hexColor('#93c5fd'), style: 'SOLID' };

const setUpTransactionsFilterBar = async ({ sheetId, sheets }: { sheetId: number; sheets: SheetsClient }) => {
  const t = TRANSACTIONS_SHEET;
  const labels = TRANSACTIONS_FILTER_BAR.flatMap(({ label }) => [`${label}:`, ALL]);
  await sheets.updateValues({
    data: [{ range: `${t}!${columnLetter(FILTER_BAR_START)}1:${columnLetter(FILTER_BAR_START + labels.length - 1)}1`, values: [labels] }],
    valueInputOption: 'RAW',
  });
  await sheets.updateValues({
    data: [
      {
        range: `${t}!${columnLetter(FILTER_BAR_HELPERS.months)}1`,
        values: [[`={"${ALL}";SORT(UNIQUE(FILTER(TEXT(A:A,"yyyy-mm"),ISNUMBER(A:A))),1,FALSE)}`]],
      },
      {
        range: `${t}!${columnLetter(FILTER_BAR_HELPERS.accounts)}1`,
        values: [[`={"${ALL}";SORT(UNIQUE(FILTER(B:B,ISNUMBER(A:A))))}`]],
      },
    ],
    valueInputOption: 'USER_ENTERED',
  });

  const dropdownRule = (options: (typeof TRANSACTIONS_FILTER_BAR)[number]['options']) => {
    if (typeof options !== 'string') {
      return { condition: { type: 'ONE_OF_LIST', values: options.map((option) => ({ userEnteredValue: option })) }, showCustomUi: true, strict: true };
    }
    const helper = columnLetter(FILTER_BAR_HELPERS[options]);
    return { condition: { type: 'ONE_OF_RANGE', values: [{ userEnteredValue: `=$${helper}$1:$${helper}` }] }, showCustomUi: true, strict: false };
  };

  await sheets.batchUpdate([
    ...TRANSACTIONS_FILTER_BAR.flatMap(({ options }, index) => {
      const labelColumn = FILTER_BAR_START + index * 2;
      const valueColumn = labelColumn + 1;
      return [
        {
          repeatCell: {
            cell: { userEnteredFormat: { horizontalAlignment: 'RIGHT', textFormat: { bold: false, foregroundColor: hexColor('#6b7280') } } },
            fields: 'userEnteredFormat(horizontalAlignment,textFormat.bold,textFormat.foregroundColor)',
            range: { endColumnIndex: labelColumn + 1, endRowIndex: 1, sheetId, startColumnIndex: labelColumn, startRowIndex: 0 },
          },
        },
        {
          repeatCell: {
            cell: {
              userEnteredFormat: {
                backgroundColor: hexColor('#dbeafe'),
                numberFormat: { pattern: '@', type: 'TEXT' },
                textFormat: { bold: false, foregroundColor: hexColor('#111827') },
              },
            },
            fields: 'userEnteredFormat(backgroundColor,numberFormat,textFormat.bold,textFormat.foregroundColor)',
            range: { endColumnIndex: valueColumn + 1, endRowIndex: 1, sheetId, startColumnIndex: valueColumn, startRowIndex: 0 },
          },
        },
        {
          setDataValidation: {
            range: { endColumnIndex: valueColumn + 1, endRowIndex: 1, sheetId, startColumnIndex: valueColumn, startRowIndex: 0 },
            rule: dropdownRule(options),
          },
        },
        {
          updateBorders: {
            bottom: FILTER_BAR_BORDER,
            left: FILTER_BAR_BORDER,
            range: { endColumnIndex: valueColumn + 1, endRowIndex: 1, sheetId, startColumnIndex: valueColumn, startRowIndex: 0 },
            right: FILTER_BAR_BORDER,
            top: FILTER_BAR_BORDER,
          },
        },
        {
          updateDimensionProperties: {
            fields: 'pixelSize,hiddenByUser',
            properties: { hiddenByUser: false, pixelSize: 72 },
            range: { dimension: 'COLUMNS', endIndex: labelColumn + 1, sheetId, startIndex: labelColumn },
          },
        },
        {
          updateDimensionProperties: {
            fields: 'pixelSize,hiddenByUser',
            properties: { hiddenByUser: false, pixelSize: index === 2 ? 190 : 140 },
            range: { dimension: 'COLUMNS', endIndex: valueColumn + 1, sheetId, startIndex: valueColumn },
          },
        },
      ];
    }),
    {
      updateDimensionProperties: {
        fields: 'pixelSize',
        properties: { pixelSize: 30 },
        range: { dimension: 'ROWS', endIndex: 1, sheetId, startIndex: 0 },
      },
    },
    {
      repeatCell: {
        cell: { userEnteredFormat: { verticalAlignment: 'MIDDLE' } },
        fields: 'userEnteredFormat.verticalAlignment',
        range: { endRowIndex: 1, sheetId, startRowIndex: 0 },
      },
    },
    {
      updateDimensionProperties: {
        fields: 'pixelSize',
        properties: { pixelSize: 24 },
        range: { dimension: 'COLUMNS', endIndex: FILTER_BAR_START, sheetId, startIndex: FILTER_BAR_START - 1 },
      },
    },
    {
      updateDimensionProperties: {
        fields: 'hiddenByUser',
        properties: { hiddenByUser: true },
        range: { dimension: 'COLUMNS', endIndex: FILTER_BAR_HELPERS.accounts + 1, sheetId, startIndex: FILTER_BAR_HELPERS.months },
      },
    },
  ]);
};

const listValidation = ({ column, options, row, sheetId }: { column: number; options: string[]; row: number; sheetId: number }) => ({
  setDataValidation: {
    range: { endColumnIndex: column + 1, endRowIndex: row + 1, sheetId, startColumnIndex: column, startRowIndex: row },
    rule: {
      condition: { type: 'ONE_OF_LIST', values: options.map((option) => ({ userEnteredValue: option })) },
      showCustomUi: true,
      strict: true,
    },
  },
});

const filterBarValueColumn = (label: (typeof TRANSACTIONS_FILTER_BAR)[number]['label']) =>
  FILTER_BAR_START + TRANSACTIONS_FILTER_BAR.findIndex((filter) => filter.label === label) * 2 + 1;

export const applyFilterOptions = async ({
  accounts,
  months,
  sheets,
}: {
  accounts: string[];
  months: string[];
  sheets: SheetsClient;
}) => {
  const ids = new Map((await sheets.getSheets()).map((sheet) => [sheet.title, sheet.sheetId]));
  const monthViewId = ids.get(MONTH_VIEW_SHEET);
  const transactionsId = ids.get(TRANSACTIONS_SHEET);
  const accountOptions = [ALL, ...accounts];
  await sheets.batchUpdate([
    ...(monthViewId === undefined
      ? []
      : [
          listValidation({ column: FILTER_VALUE_COLUMN, options: months, row: FILTERS.indexOf('Month') + 1, sheetId: monthViewId }),
          listValidation({ column: FILTER_VALUE_COLUMN, options: accountOptions, row: FILTERS.indexOf('Account') + 1, sheetId: monthViewId }),
        ]),
    ...(transactionsId === undefined
      ? []
      : [
          listValidation({ column: filterBarValueColumn('Month'), options: [ALL, ...months], row: 0, sheetId: transactionsId }),
          listValidation({ column: filterBarValueColumn('Account'), options: accountOptions, row: 0, sheetId: transactionsId }),
        ]),
  ]);
};

export const formatTransactionsSheet = async (sheets: SheetsClient) => {
  const details = await sheets.getSheetDetails(TRANSACTIONS_SHEET);
  if (!details) {
    return { formatted: false };
  }
  const { bandedRangeIds, conditionalFormatCount, sheetId, slicerIds } = details;
  await sheets.updateValues({
    data: [{ range: `${TRANSACTIONS_SHEET}!${MONTH_COLUMN.letter}1`, values: [[monthColumnFormula()]] }],
    valueInputOption: 'USER_ENTERED',
  });
  const monthViewId = (await sheets.getSheets()).find((sheet) => sheet.title === MONTH_VIEW_SHEET)?.sheetId;

  await sheets.batchUpdate([
    numberFormat({ endColumn: 1, pattern: FRIENDLY_DATE, sheetId, startColumn: 0, startRow: 1, type: 'DATE' }),
    numberFormat({ endColumn: 5, pattern: CURRENCY, sheetId, startColumn: 4, startRow: 1, type: 'CURRENCY' }),
    ...(monthViewId === undefined
      ? []
      : [numberFormat({ endColumn: 4, pattern: FRIENDLY_DATE, sheetId: monthViewId, startColumn: 3, startRow: 4, type: 'DATE' })]),
    ...bandedRangeIds.map((bandedRangeId) => ({ deleteBanding: { bandedRangeId } })),
    ...slicerIds.map((objectId) => ({ deleteEmbeddedObject: { objectId } })),
    ...Array.from({ length: conditionalFormatCount }, (_, offset) => ({
      deleteConditionalFormatRule: { index: conditionalFormatCount - 1 - offset, sheetId },
    })),
    ...TRANSACTIONS_COLUMN_WIDTHS.map((pixelSize, index) => ({
      updateDimensionProperties: {
        fields: 'pixelSize,hiddenByUser',
        properties: { hiddenByUser: false, pixelSize },
        range: { dimension: 'COLUMNS', endIndex: index + 1, sheetId, startIndex: index },
      },
    })),
    {
      updateDimensionProperties: {
        fields: 'hiddenByUser',
        properties: { hiddenByUser: true },
        range: { dimension: 'COLUMNS', endIndex: HIDDEN_COLUMNS.end, sheetId, startIndex: HIDDEN_COLUMNS.start },
      },
    },
    {
      repeatCell: {
        cell: {
          userEnteredFormat: {
            textFormat: { bold: true },
            verticalAlignment: 'MIDDLE',
          },
        },
        fields: 'userEnteredFormat(textFormat.bold,verticalAlignment)',
        range: { endRowIndex: 1, sheetId, startRowIndex: 0 },
      },
    },
    {
      repeatCell: {
        cell: { userEnteredFormat: { horizontalAlignment: 'CENTER' } },
        fields: 'userEnteredFormat.horizontalAlignment',
        range: { endColumnIndex: 7, sheetId, startColumnIndex: 6, startRowIndex: 1 },
      },
    },
    {
      addBanding: {
        bandedRange: {
          range: { endColumnIndex: VISIBLE_COLUMN_COUNT, sheetId, startColumnIndex: 0, startRowIndex: 0 },
          rowProperties: {
            firstBandColor: hexColor('#ffffff'),
            headerColor: hexColor('#e5e7eb'),
            secondBandColor: hexColor('#f8fafc'),
          },
        },
      },
    },
    rowHighlight({ formula: '=$E2<0', sheetId, textColor: '#15803d' }),
    rowHighlight({ background: '#ede9fe', formula: '=$F2="Transfer"', sheetId, textColor: '#5b21b6' }),
    rowHighlight({ background: '#dcfce7', formula: '=$F2="Income"', sheetId, textColor: '#166534' }),
    rowHighlight({ background: '#fef3c7', formula: '=$G2=TRUE', sheetId }),
    {
      updateDimensionProperties: {
        fields: 'pixelSize,hiddenByUser',
        properties: { hiddenByUser: false, pixelSize: 80 },
        range: { dimension: 'COLUMNS', endIndex: MONTH_COLUMN.index + 1, sheetId, startIndex: MONTH_COLUMN.index },
      },
    },
    { setBasicFilter: { filter: { range: { endColumnIndex: FILTERED_COLUMN_COUNT, sheetId, startColumnIndex: 0, startRowIndex: 0 } } } },
  ]);

  await sheets.batchUpdate([
    {
      setDataValidation: {
        range: { endColumnIndex: 6, sheetId, startColumnIndex: 5, startRowIndex: 1 },
        rule: {
          condition: { type: 'ONE_OF_LIST', values: ALL_CATEGORIES.map((category) => ({ userEnteredValue: category })) },
          showCustomUi: true,
          strict: true,
        },
      },
    },
  ]);
  await setUpTransactionsFilterBar({ sheetId, sheets });

  if (monthViewId !== undefined) {
    await setUpMonthViewControls({ sheetId: monthViewId, sheets });
  }

  return { formatted: true };
};

export const ensureSheetSetup = async (sheets: SheetsClient) => {
  const existing = new Set((await sheets.getSheets()).map((sheet) => sheet.title));
  const missing = [TRANSACTIONS_SHEET, RULES_SHEET, MONTH_VIEW_SHEET, ACCOUNTS_SHEET].filter((title) => !existing.has(title));
  if (existing.has(TRANSACTIONS_SHEET)) {
    await sheets.updateValues({
      data: [{ range: `${TRANSACTIONS_SHEET}!A1:L1`, values: [[...LEDGER_HEADERS]] }],
      valueInputOption: 'RAW',
    });
  }
  if (existing.has(MONTH_VIEW_SHEET)) {
    await sheets.updateValues({
      data: [{ range: MONTH_VIEW_LIST_RANGE, values: [[monthViewListFormula()]] }],
      valueInputOption: 'USER_ENTERED',
    });
  }
  if (missing.length === 0) {
    return;
  }

  const { replies } = await sheets.batchUpdate(missing.map((title) => ({ addSheet: { properties: { gridProperties: { frozenRowCount: 1 }, title } } })));
  const created = new Map(replies.flatMap((reply) => (reply.addSheet ? [[reply.addSheet.properties.title, reply.addSheet.properties.sheetId] as const] : [])));

  const transactionsId = created.get(TRANSACTIONS_SHEET);
  if (transactionsId !== undefined) {
    await sheets.updateValues({ data: [{ range: `${TRANSACTIONS_SHEET}!A1:L1`, values: [[...LEDGER_HEADERS]] }], valueInputOption: 'RAW' });
    await sheets.batchUpdate([
      numberFormat({ endColumn: 1, pattern: FRIENDLY_DATE, sheetId: transactionsId, startColumn: 0, startRow: 1, type: 'DATE' }),
      numberFormat({ endColumn: 5, pattern: '$#,##0.00;-$#,##0.00', sheetId: transactionsId, startColumn: 4, startRow: 1, type: 'CURRENCY' }),
      {
        setDataValidation: {
          range: { endColumnIndex: 6, sheetId: transactionsId, startColumnIndex: 5, startRowIndex: 1 },
          rule: {
            condition: { type: 'ONE_OF_LIST', values: ALL_CATEGORIES.map((category) => ({ userEnteredValue: category })) },
            showCustomUi: true,
            strict: true,
          },
        },
      },
      {
        addFilterView: {
          filter: {
            criteria: { 6: { condition: { type: 'CUSTOM_FORMULA', values: [{ userEnteredValue: '=$G2=TRUE' }] } } },
            range: { sheetId: transactionsId, startRowIndex: 0 },
            title: 'Needs review',
          },
        },
      },
    ]);
    await formatTransactionsSheet(sheets);
  }

  const accountsId = created.get(ACCOUNTS_SHEET);
  if (accountsId !== undefined) {
    await sheets.updateValues({ data: [{ range: `${ACCOUNTS_SHEET}!A1:C1`, values: [[...ACCOUNTS_HEADERS]] }], valueInputOption: 'RAW' });
    await sheets.batchUpdate([
      {
        repeatCell: {
          cell: { userEnteredFormat: { backgroundColor: hexColor('#e5e7eb'), textFormat: { bold: true } } },
          fields: 'userEnteredFormat(backgroundColor,textFormat.bold)',
          range: { endRowIndex: 1, sheetId: accountsId, startRowIndex: 0 },
        },
      },
      {
        repeatCell: {
          cell: { userEnteredFormat: { backgroundColor: hexColor('#dbeafe') } },
          fields: 'userEnteredFormat.backgroundColor',
          range: { endColumnIndex: 2, sheetId: accountsId, startColumnIndex: 1, startRowIndex: 1 },
        },
      },
      ...[260, 220, 200].map((pixelSize, index) => ({
        updateDimensionProperties: {
          fields: 'pixelSize',
          properties: { pixelSize },
          range: { dimension: 'COLUMNS', endIndex: index + 1, sheetId: accountsId, startIndex: index },
        },
      })),
    ]);
  }

  if (created.has(RULES_SHEET)) {
    await sheets.updateValues({
      data: [{ range: `${RULES_SHEET}!A1:B${SEED_RULES.length + 1}`, values: [['Pattern', 'Category'], ...SEED_RULES.map((rule) => [rule.pattern, rule.category])] }],
      valueInputOption: 'RAW',
    });
  }

  const monthViewId = created.get(MONTH_VIEW_SHEET);
  if (monthViewId !== undefined) {
    const { firstRow, incomeRow, rows } = monthViewValues();
    await sheets.updateValues({ data: rows, valueInputOption: 'USER_ENTERED' });
    await sheets.batchUpdate([
      numberFormat({ endColumn: 2, endRow: 2, pattern: 'yyyy-mm-dd', sheetId: monthViewId, startColumn: 1, startRow: 1, type: 'DATE' }),
      numberFormat({ endColumn: 2, endRow: incomeRow, pattern: '$#,##0.00', sheetId: monthViewId, startColumn: 1, startRow: firstRow - 1, type: 'CURRENCY' }),
      numberFormat({ endColumn: 2, endRow: incomeRow + 1, pattern: '0.0%', sheetId: monthViewId, startColumn: 1, startRow: incomeRow, type: 'PERCENT' }),
      numberFormat({ endColumn: 4, pattern: FRIENDLY_DATE, sheetId: monthViewId, startColumn: 3, startRow: 4, type: 'DATE' }),
      numberFormat({ endColumn: 7, pattern: '$#,##0.00;-$#,##0.00', sheetId: monthViewId, startColumn: 6, startRow: 4, type: 'CURRENCY' }),
    ]);
  }
};
