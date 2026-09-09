// Original evaluator: cards 0..51 = suit * 13 + rankIndex (2..A).
// Lexicographic rank tuples are encoded base 15; higher always wins.
globalThis.holdemEvaluate = (() => {
  function five(cards) {
    const ranks = cards.map(card => card % 13 + 2).sort((a, b) => b - a)
    const counts = {}
    for (const rank of ranks) counts[rank] = (counts[rank] || 0) + 1
    const groups = Object.keys(counts).map(Number).sort((a, b) => counts[b] - counts[a] || b - a)
    const unique = [...new Set(ranks)]
    const flush = cards.every(card => Math.floor(card / 13) === Math.floor(cards[0] / 13))
    const straight = unique.length === 5 && unique[0] - unique[4] === 4
      ? unique[0]
      : unique.join(',') === '14,5,4,3,2'
      ? 5
      : 0
    let tuple
    if (flush && straight) tuple = [8, straight]
    else if (counts[groups[0]] === 4) tuple = [7, ...groups]
    else if (counts[groups[0]] === 3 && counts[groups[1]] === 2) tuple = [6, ...groups]
    else if (flush) tuple = [5, ...ranks]
    else if (straight) tuple = [4, straight]
    else if (counts[groups[0]] === 3) tuple = [3, ...groups]
    else if (counts[groups[0]] === 2 && counts[groups[1]] === 2) tuple = [2, ...groups]
    else if (counts[groups[0]] === 2) tuple = [1, ...groups]
    else tuple = [0, ...ranks]
    while (tuple.length < 6) tuple.push(0)
    return tuple.reduce((value, digit) => value * 15 + digit, 0)
  }
  return cards => {
    if (
      cards.length < 5 || cards.length > 7 || new Set(cards).size !== cards.length
      || cards.some(card => !Number.isInteger(card) || card < 0 || card > 51)
    ) throw Error('invalid_cards')
    let best = -1
    for (let a = 0; a < cards.length - 4; a++) {
      for (let b = a + 1; b < cards.length - 3; b++) {
        for (let c = b + 1; c < cards.length - 2; c++) {
          for (let d = c + 1; d < cards.length - 1; d++) {
            for (let e = d + 1; e < cards.length; e++) {
              best = Math.max(best, five([cards[a], cards[b], cards[c], cards[d], cards[e]]))
            }
          }
        }
      }
    }
    return best
  }
})()
