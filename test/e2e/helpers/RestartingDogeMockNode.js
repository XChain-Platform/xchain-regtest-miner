'use strict';

const StatefulMockNode = require('./StatefulMockNode');

// Resets the wallet fee state while keeping Dogecoin's single wallet loaded.
class RestartingDogeMockNode extends StatefulMockNode {
    restartWalletState() {
        this.walletFeeRate = 0;
    }
}

module.exports = RestartingDogeMockNode;
