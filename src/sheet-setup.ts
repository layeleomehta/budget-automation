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
  return `=IFERROR(SORT(FILTER({${t}!A:A,${t}!B:B,${t}!C:C,${t}!E:E,${t}!F:F,${t}!G:G},ISNUMBER(${t}!A:A),${t}!A:A>=$B$2,${t}!A:A<EDATE($B$2,1)),1,TRUE),"No transactions")`;
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
      numberFormat({ endColumn: 1, pattern: 'yyyy-mm-dd', sheetId: transactionsId, startColumn: 0, startRow: 1, type: 'DATE' }),
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
      numberFormat({ endColumn: 4, pattern: 'yyyy-mm-dd', sheetId: monthViewId, startColumn: 3, startRow: 4, type: 'DATE' }),
      numberFormat({ endColumn: 7, pattern: '$#,##0.00;-$#,##0.00', sheetId: monthViewId, startColumn: 6, startRow: 4, type: 'CURRENCY' }),
    ]);
  }
};
