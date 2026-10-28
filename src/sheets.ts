const BASE_URL = 'https://sheets.googleapis.com/v4/spreadsheets';

export type ValueInputOption = 'RAW' | 'USER_ENTERED';

export type SheetsClient = ReturnType<typeof createSheetsClient>;

export const createSheetsClient = ({
  getAccessToken,
  spreadsheetId,
}: {
  getAccessToken: () => Promise<string>;
  spreadsheetId: string;
}) => {
  const request = async <T>(path: string, init?: RequestInit): Promise<T> => {
    const response = await fetch(`${BASE_URL}/${spreadsheetId}${path}`, {
      ...init,
      headers: { Authorization: `Bearer ${await getAccessToken()}`, 'Content-Type': 'application/json' },
    });
    if (!response.ok) {
      throw new Error(`Sheets ${init?.method ?? 'GET'} ${path} failed with ${response.status}: ${await response.text()}`);
    }
    return (await response.json()) as T;
  };

  return {
    appendValues: ({
      range,
      valueInputOption,
      values,
    }: {
      range: string;
      valueInputOption: ValueInputOption;
      values: unknown[][];
    }) =>
      request(
        `/values/${encodeURIComponent(range)}:append?valueInputOption=${valueInputOption}&insertDataOption=INSERT_ROWS`,
        { body: JSON.stringify({ values }), method: 'POST' },
      ),

    batchUpdate: (requests: unknown[]) =>
      request<{ replies: { addSheet?: { properties: { sheetId: number; title: string } } }[] }>(':batchUpdate', {
        body: JSON.stringify({ requests }),
        method: 'POST',
      }),

    clearValues: (range: string) =>
      request(`/values/${encodeURIComponent(range)}:clear`, { body: '{}', method: 'POST' }),

    getSheetDetails: async (title: string) => {
      const { sheets } = await request<{
        sheets: {
          bandedRanges?: { bandedRangeId: number }[];
          conditionalFormats?: unknown[];
          properties: { sheetId: number; title: string };
          slicers?: { slicerId: number }[];
        }[];
      }>('?fields=sheets(properties(sheetId,title),bandedRanges(bandedRangeId),conditionalFormats,slicers(slicerId))');
      const sheet = sheets.find((candidate) => candidate.properties.title === title);
      if (!sheet) {
        return undefined;
      }
      return {
        bandedRangeIds: (sheet.bandedRanges ?? []).map((banded) => banded.bandedRangeId),
        conditionalFormatCount: sheet.conditionalFormats?.length ?? 0,
        sheetId: sheet.properties.sheetId,
        slicerIds: (sheet.slicers ?? []).map((slicer) => slicer.slicerId),
      };
    },

    getSheets: async () => {
      const { sheets } = await request<{ sheets: { properties: { sheetId: number; title: string } }[] }>(
        '?fields=sheets.properties(sheetId,title)',
      );
      return sheets.map((sheet) => sheet.properties);
    },

    getValues: async (range: string) => {
      const { values } = await request<{ values?: unknown[][] }>(
        `/values/${encodeURIComponent(range)}?valueRenderOption=UNFORMATTED_VALUE&dateTimeRenderOption=SERIAL_NUMBER`,
      );
      return values ?? [];
    },

    updateValues: ({
      data,
      valueInputOption,
    }: {
      data: { range: string; values: unknown[][] }[];
      valueInputOption: ValueInputOption;
    }) =>
      data.length === 0
        ? Promise.resolve()
        : request('/values:batchUpdate', { body: JSON.stringify({ data, valueInputOption }), method: 'POST' }),
  };
};
