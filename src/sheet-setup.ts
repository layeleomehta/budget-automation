import { ALL_CATEGORIES, BUDGET_CATEGORIES, INCOME, UNCATEGORIZED } from './categories';
import { LEDGER_HEADERS, TRANSACTIONS_SHEET } from './ledger';
import { SEED_RULES } from './rules';
import type { SheetsClient } from './sheets';

export const RULES_SHEET = 'Rules';
export const MONTH_VIEW_SHEET = 'Month View';

const monthSum = ({ categoryRef }: { categoryRef: string }) =>
  `=SUMIFS(${TRANSACTIONS_SHEET}!$E:$E,${TRANSACTIONS_SHEET}!$F:$F,${categoryRef},${TRANSACTIONS_SHEET}!$A:$A,">="&$B$2,${TRANSACTIONS_SHEET}!$A:$A,"<"&EDATE($B$2,1))`;

const MONTH_VIEW_LIST_RANGE = `'${MONTH_VIEW_SHEET}'!D5`;

const monthViewListFormula = () => {
  const t = TRANSACTIONS_SHEET;
  return `=IFERROR(SORT(FILTER({${t}!A:A,${t}!B:B,${t}!C:C,${t}!E:E,${t}!F:F,${t}!G:G},ISNUMBER(${t}!A:A),${t}!A:A>=$B$2,${t}!A:A<EDATE($B$2,1)),1,FALSE),"No transactions")`;
};

const monthViewValues = () => {
  const summaryCategories = [...BUDGET_CATEGORIES, UNCATEGORIZED];
  const firstRow = 5;
  const lastRow = firstRow + summaryCategories.length - 1;
  const totalRow = lastRow + 1;
  const incomeRow = totalRow + 1;
  return {
    rows: [
      { range: `'${MONTH_VIEW_SHEET}'!A1:B2`, values: [['Month (YYYY-MM)', '=TEXT(TODAY(),"yyyy-mm")'], ['Start', '=DATEVALUE(B1&"-01")']] },
      {
        range: `'${MONTH_VIEW_SHEET}'!A4:B${incomeRow + 1}`,
        values: [
          ['Category', 'Amount'],
          ...summaryCategories.map((category, index) => [category, monthSum({ categoryRef: `$A${firstRow + index}` })]),
          ['TOTAL EXPENDITURE', `=SUM(B${firstRow}:B${lastRow})`],
          ['TOTAL INCOME', `=-${monthSum({ categoryRef: `"${INCOME}"` }).slice(1)}`],
          ['SAVINGS RATE', `=IF(B${incomeRow}>0,1-B${totalRow}/B${incomeRow},"")`],
        ],
      },
      {
        range: `'${MONTH_VIEW_SHEET}'!D4:I5`,
        values: [['Date', 'Account', 'Merchant', 'Amount', 'Category', 'Review'], [monthViewListFormula()]],
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
const HIDDEN_COLUMNS = { end: 11, start: 8 };
const VISIBLE_COLUMN_COUNT = TRANSACTIONS_COLUMN_WIDTHS.length;

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

export const formatTransactionsSheet = async (sheets: SheetsClient) => {
  const details = await sheets.getSheetDetails(TRANSACTIONS_SHEET);
  if (!details) {
    return { formatted: false };
  }
  const { bandedRangeIds, conditionalFormatCount, sheetId } = details;
  const monthViewId = (await sheets.getSheets()).find((sheet) => sheet.title === MONTH_VIEW_SHEET)?.sheetId;

  await sheets.batchUpdate([
    numberFormat({ endColumn: 1, pattern: FRIENDLY_DATE, sheetId, startColumn: 0, startRow: 1, type: 'DATE' }),
    numberFormat({ endColumn: 5, pattern: CURRENCY, sheetId, startColumn: 4, startRow: 1, type: 'CURRENCY' }),
    ...(monthViewId === undefined
      ? []
      : [numberFormat({ endColumn: 4, pattern: FRIENDLY_DATE, sheetId: monthViewId, startColumn: 3, startRow: 4, type: 'DATE' })]),
    ...bandedRangeIds.map((bandedRangeId) => ({ deleteBanding: { bandedRangeId } })),
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
    rowHighlight({ formula: '=$F2="Transfer"', sheetId, textColor: '#9ca3af' }),
    rowHighlight({ background: '#fef3c7', formula: '=$G2=TRUE', sheetId }),
    { setBasicFilter: { filter: { range: { endColumnIndex: VISIBLE_COLUMN_COUNT, sheetId, startColumnIndex: 0, startRowIndex: 0 } } } },
  ]);

  return { formatted: true };
};

export const ensureSheetSetup = async (sheets: SheetsClient) => {
  const existing = new Set((await sheets.getSheets()).map((sheet) => sheet.title));
  const missing = [TRANSACTIONS_SHEET, RULES_SHEET, MONTH_VIEW_SHEET].filter((title) => !existing.has(title));
  if (missing.length === 0) {
    await sheets.updateValues({
      data: [{ range: MONTH_VIEW_LIST_RANGE, values: [[monthViewListFormula()]] }],
      valueInputOption: 'USER_ENTERED',
    });
    return;
  }

  const { replies } = await sheets.batchUpdate(missing.map((title) => ({ addSheet: { properties: { gridProperties: { frozenRowCount: 1 }, title } } })));
  const created = new Map(replies.flatMap((reply) => (reply.addSheet ? [[reply.addSheet.properties.title, reply.addSheet.properties.sheetId] as const] : [])));

  const transactionsId = created.get(TRANSACTIONS_SHEET);
  if (transactionsId !== undefined) {
    await sheets.updateValues({ data: [{ range: `${TRANSACTIONS_SHEET}!A1:K1`, values: [[...LEDGER_HEADERS]] }], valueInputOption: 'RAW' });
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
