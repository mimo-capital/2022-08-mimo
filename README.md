# SuperVaults V2

SuperVaults V2 enables any user to deploy their own proxy contract to extend the functionality of the Mimo protocol. This opens users up to do complicated vault operations such as:

- All `vaultsCore` operations through `delegateCall`s
- Leveraging collateral to be more sensitive to price movements
- Rebalancing collateral between vaults without additional capital
- Repaying a vault's debt using the collateral and withdrawing leftover collateral
- Delegating control for anyone to rebalance one's vaults to avoid liquidation, with restrictions to preserve the value held in the vault
- Delegating control to a manger to rebalance one's vaults based on future market predictions, with restrictions to preserve the value held in the vault

See [docs/](docs/) for more documentation.

## Getting started

Install all dependencies with `yarn` first.

To run all tests in the test suite, including both the integration tests and the unit tests, use:

```
yarn test
```

## Polygon Deployment

| Contract             | Polygonscan                                                                     |
| -------------------- | ------------------------------------------------------------------------------- |
| MIMOAutoRebalance    | https://polygonscan.com/address/0xE71851bF87Acd2A69d135504Ac0E02Cc38096C38#code |
| MIMOEmptyVault       | https://polygonscan.com/address/0x54edBd7FB9F39953F3ceAeB9Ecb55522A0481284#code |
| MIMOLeverage         | https://polygonscan.com/address/0x538bf7635921DFA4023819a0D639F40E3d79A19f#code |
| MIMOManagedRebalance | https://polygonscan.com/address/0xD332f53FCA56722F209379EEda6bc488BB29BfB5#code |
| MIMOProxyActions     | https://polygonscan.com/address/0xaA2d75b00Ab98043d7ddCD73615636014d52053F#code |
| MIMOProxyFactory     | https://polygonscan.com/address/0x44e3c7B3994ce6C29a4E64A16ff998DAb5f996a3#code |
| MIMOProxyGuardBase   | https://polygonscan.com/address/0x2BaD16A8fc3BB58733D3742D84226FBDe200C27e#code |
| MIMORebalance        | https://polygonscan.com/address/0x871269426857dc29cfdc5fBD028a1357bC3FEa97#code |
| MIMOVaultActions     | https://polygonscan.com/address/0xE84eefb06a5fb49AeA53104A68DeC4Cbb4F5eD9f#code |
