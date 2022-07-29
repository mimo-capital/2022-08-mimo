# ✨ So you want to sponsor a contest

This `README.md` contains a set of checklists for our contest collaboration.

Your contest will use two repos: 
- **a _contest_ repo** (this one), which is used for scoping your contest and for providing information to contestants (wardens)
- **a _findings_ repo**, where issues are submitted (shared with you after the contest) 

Ultimately, when we launch the contest, this contest repo will be made public and will contain the smart contracts to be reviewed and all the information needed for contest participants. The findings repo will be made public after the contest report is published and your team has mitigated the identified issues.

Some of the checklists in this doc are for **C4 (🐺)** and some of them are for **you as the contest sponsor (⭐️)**.

---

# Contest setup

## ⭐️ Sponsor: Provide contest details

Under "SPONSORS ADD INFO HERE" heading below, include the following:

- [ ] Create a PR to this repo with the below changes:
- [ ] Name of each contract and:
  - [ ] source lines of code (excluding blank lines and comments) in each
  - [ ] external contracts called in each
  - [ ] libraries used in each
- [ ] Describe any novel or unique curve logic or mathematical models implemented in the contracts
- [ ] Does the token conform to the ERC-20 standard? In what specific ways does it differ?
- [ ] Describe anything else that adds any special logic that makes your approach unique
- [ ] Identify any areas of specific concern in reviewing the code
- [ ] Add all of the code to this repo that you want reviewed


---

# Contest prep

## ⭐️ Sponsor: Contest prep
- [ ] Provide a self-contained repository with working commands that will build (at least) all in-scope contracts, and commands that will run tests producing gas reports for the relevant contracts.
- [ ] Make sure your code is thoroughly commented using the [NatSpec format](https://docs.soliditylang.org/en/v0.5.10/natspec-format.html#natspec-format).
- [ ] Modify the bottom of this `README.md` file to describe how your code is supposed to work with links to any relevent documentation and any other criteria/details that the C4 Wardens should keep in mind when reviewing. ([Here's a well-constructed example.](https://github.com/code-423n4/2021-06-gro/blob/main/README.md))
- [ ] Please have final versions of contracts and documentation added/updated in this repo **no less than 24 hours prior to contest start time.**
- [ ] Be prepared for a 🚨code freeze🚨 for the duration of the contest — important because it establishes a level playing field. We want to ensure everyone's looking at the same code, no matter when they look during the contest. (Note: this includes your own repo, since a PR can leak alpha to our wardens!)
- [ ] Promote the contest on Twitter (optional: tag in relevant protocols, etc.)
- [ ] Share it with your own communities (blog, Discord, Telegram, email newsletters, etc.)
- [ ] Optional: pre-record a high-level overview of your protocol (not just specific smart contract functions). This saves wardens a lot of time wading through documentation.
- [ ] Delete this checklist and all text above the line below when you're ready.

---

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