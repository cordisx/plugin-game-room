export default {
  extends: ['stylelint-config-standard'],
  plugins: ['@projectwallace/stylelint-plugin'],
  rules: {
    'projectwallace/max-lines-of-code': 1000,
    'selector-max-specificity': '0,4,1',
    'rule-empty-line-before': null,
    'at-rule-empty-line-before': null,
  },
}
