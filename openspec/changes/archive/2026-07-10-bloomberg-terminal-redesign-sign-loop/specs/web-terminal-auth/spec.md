## ADDED Requirements

### Requirement: Terminal visual system
The web UI SHALL use a Bloomberg Terminal-inspired visual system with black backgrounds, amber primary accents, mono typography, square corners, single-pixel borders, and no decorative glows or gradients.

#### Scenario: User opens the public home page
- **WHEN** the home page renders
- **THEN** it displays a full-width top status bar, a two-column terminal dashboard, and a fixed bottom shortcut bar
- **AND** buttons, cells, panels, and navigation use square edges and terminal-style uppercase labels

### Requirement: Manual SIWE signing
The wallet button SHALL NOT automatically trigger SIWE login after a wallet connects.

#### Scenario: Wallet connected but not signed
- **WHEN** a wallet is connected to Arc Testnet and no authenticated session exists
- **THEN** the wallet button displays a manual sign-in call to action
- **AND** SIWE login is only attempted after the user clicks that call to action

#### Scenario: Signature cancelled
- **WHEN** the user cancels or rejects the SIWE signature request
- **THEN** the wallet button returns to the connected-but-not-signed state
- **AND** the UI shows a fixed mono error toast
- **AND** the component does not automatically retry login

### Requirement: Terminal network mismatch banner
The network mismatch warning SHALL render as a single-line terminal banner with red border and explicit expected/current chain labels.

#### Scenario: Wallet is on the wrong network
- **WHEN** the wallet is connected and the chain is not Arc Testnet
- **THEN** the app displays a full-width red-bordered banner with a switch-network action
