/*********************************************************************
 *
 * Copyright © 2025-2026 Dankest, LLC
 * SPDX-License-Identifier: AGPL-3.0-or-later
 *
 * This file is part of XChain Platform. Licensed under the GNU Affero
 * General Public License v3.0 or later; see LICENSE.md.
 *
 **********************************************************************/
'use strict';

const StatefulMockNode = require('./StatefulMockNode');

// Resets the wallet fee state while keeping Dogecoin's single wallet loaded.
class RestartingDogeMockNode extends StatefulMockNode {
    restartWalletState() {
        this.walletFeeRate = 0;
    }
}

module.exports = RestartingDogeMockNode;
