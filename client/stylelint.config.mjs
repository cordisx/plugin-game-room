export default {
  plugins: ['@projectwallace/stylelint-plugin'],
  rules: {
    'projectwallace/max-lines-of-code': 1000,
    'block-no-empty': true,
    'color-no-invalid-hex': true,
    'declaration-block-no-duplicate-properties': true,
    'selector-max-specificity': '0,3,0',
  },
}
