'use strict';

/* eslint-disable no-underscore-dangle */

const StatefulMockNode = require('./StatefulMockNode');

// Adds the restart-sensitive wallet fee state that Dogecoin keeps only in memory.
class RestartingDogeMockNode extends StatefulMockNode {
    constructor(options) {
        super(options);
        this.walletFeeRate = 0;
    }

    restartWalletState() {
        this.walletFeeRate = 0;
    }

    _rpc_getwalletinfo(params, wallet) {
        return { ...super._rpc_getwalletinfo(params, wallet), paytxfee: this.walletFeeRate };
    }

    _rpc_settxfee(params) {
        const result = super._rpc_settxfee(params);
        this.walletFeeRate = Array.isArray(params) ? params[0] : params;
        return result;
    }
}

module.exports = RestartingDogeMockNode;
