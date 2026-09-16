/** Both entry points use the same Host route; its header returns to the personal parent. */
export function openLedgerPage<T>(navigate: (page: string) => T): T {
  return navigate('ledger')
}
