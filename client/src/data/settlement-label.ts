/** Display-only labels: raw policy identifiers remain in room data and consent. */
export function settlementLabel(policy: string, mode?: string): string {
  if (mode === 'token') return '只扣各自投入；取消后释放原投入。胜负使用分数或本局筹码。'
  switch (policy) {
    case 'equal-winners-v1':
      return '胜者均分；余数按席位顺序分配，无胜者时退回各自投入'
    case 'conserved-payouts-v1':
      return '按游戏结果分配，总额等于全桌投入'
    default:
      return policy
  }
}
