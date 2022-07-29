# Mimo August 2022 contest details
- $47,500 USDC main award pot
- $2,500 USDC gas optimization award pot
- Join [C4 Discord](https://discord.gg/code4rena) to register
- Submit findings [using the C4 form](https://code4rena.com/contests/2022-08-mimo-contest/submit)
- [Read our guidelines for more details](https://docs.code4rena.com/roles/wardens)
- Starts August 2, 2022 20:00 UTC
- Ends August 7, 2022 20:00 UTC

# SuperVaults V2
SuperVaults V2 enables any user to deploy their own proxy contract to extend the functionality of the Mimo protocol. This opens users up to do complicated vault operations such as:
- All `vaultsCore` operations through `delegateCall`s
- Leveraging collateral to be more sensitive to price movements
- Rebalancing collateral between vaults without additional capital 
- Repaying a vault's debt using the collateral and withdrawing leftover collateral  
- Delegating control for anyone to rebalance one's vaults to avoid liquidation, with restrictions to preserve the value held in the vault
- Delegating control to a manger to rebalance one's vaults based on future market predictions, with restrictions to preserve the value held in the vault

See [docs/](docs/) for more documentation and [docs/Contracts.md/](docs/Contracts.md) for an overview of all the contracts.

## Getting started

Install all dependencies with `yarn` first.

To run all tests in the test suite, including both the integration tests and the unit tests, use:

```
yarn test
```

Note: integration tests are expected to occasionally fail due to them depending on 1inch/Paraswap API and being run against a forked network. Tests should pass after 2 or 3 retries max.

## Files in Scope

```
-----------------------------------------------------------------------------------------------------------------
File                                                                          blank        comment           code
-----------------------------------------------------------------------------------------------------------------
contracts/actions/MIMOEmptyVault.sol                                             18             35             77
contracts/actions/MIMOFlashloan.sol                                               8             18             33
contracts/actions/MIMOLeverage.sol                                               22             34             83
contracts/actions/MIMORebalance.sol                                              13             36             90
contracts/actions/MIMOSwap.sol                                                   10             16             40
contracts/actions/MIMOVaultActions.sol                                           12             45             55
contracts/actions/automated/MIMOAutoAction.sol                                   20             23             66
contracts/actions/automated/MIMOAutoRebalance.sol                                33             76            178
contracts/actions/automated/interfaces/IMIMOAutoAction.sol                        9              1             26
contracts/actions/automated/interfaces/IMIMOAutoRebalance.sol                     4              1             14
contracts/actions/interfaces/IMIMOEmptyVault.sol                                  2              1             11
contracts/actions/interfaces/IMIMOFlashloan.sol                                   5              1             20
contracts/actions/interfaces/IMIMOLeverage.sol                                    3              1             12
contracts/actions/interfaces/IMIMOProxyAction.sol                                 1              1              4
contracts/actions/interfaces/IMIMORebalance.sol                                   3              1             18
contracts/actions/interfaces/IMIMOSwap.sol                                        2              1              8
contracts/actions/interfaces/IMIMOVaultActions.sol                               11              1             20
contracts/actions/managed/MIMOManagedAction.sol                                  25             30             77
contracts/actions/managed/MIMOManagedRebalance.sol                               26             47            139
contracts/actions/managed/interfaces/IMIMOManagedAction.sol                      11              1             26
contracts/actions/managed/interfaces/IMIMOManagedRebalance.sol                    3              1             13
contracts/proxy/MIMOProxy.sol                                                    25             28             95
contracts/proxy/MIMOProxyFactory.sol                                             16             15             27
contracts/proxy/MIMOProxyRegistry.sol                                            15             16             28
contracts/proxy/interfaces/IMIMOProxy.sol                                        13             45             22
contracts/proxy/interfaces/IMIMOProxyFactory.sol                                  9             16              9
contracts/proxy/interfaces/IMIMOProxyRegistry.sol                                 7             23              9
-----------------------------------------------------------------------------------------------------------------
SUM:                                                                            326            514           1200
-----------------------------------------------------------------------------------------------------------------
```

## Scoping details answers

```
### Do you have a link to the repo that the contest will cover?

Repo is still private, I can invite anyone that wants to take a look at it

### How many (non-library) contracts are in the scope?

20 contracts + 7 interfaces. A large portion of the contracts were part of our first audit

### Total sLoC in these contracts?

1250

### How many library dependencies?

BoringBatchable + various OpenZeppelin libraries that are out of scope

### How many separate interfaces and struct definitions are there for the contracts within scope?

10 structs and 7 interfaces

### Does most of your code generally use composition or inheritance?

Yes

### How many external calls?

This project is dependent on our main Mimo protocol, Aave, 1inch and Paraswap

### Is there a need to understand a separate part of the codebase / get context in order to audit this part of the protocol?

true

### Please describe required context

Understanding of our main Mimo protocol is required to understand this project

### Does it use an oracle?

false

### Does the token conform to the ERC20 standard?

Yes

### Are there any novel or unique curve logic or mathematical models?

No

### Does it use a timelock function?

No

### Is it an NFT?

No

### Does it have an AMM?

No

### Is it a fork of a popular project?

false

### Does it use rollups?

false

### Is it multi-chain?

true

### Does it use a side-chain?

false
```
