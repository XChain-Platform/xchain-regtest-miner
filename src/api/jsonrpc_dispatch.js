/*********************************************************************
 *
 * Copyright © 2025–2026 Dankest, LLC
 * Based on XChain Platform by Dankest, LLC – https://dankest.llc
 *
 * SPDX-License-Identifier: AGPL-3.0-or-later
 *
 * This file is part of XChain Platform. Licensed under the GNU Affero
 * General Public License v3.0 or later; see LICENSE.md. A commercial
 * license (without AGPL source-disclosure terms) is available -
 * contact legal@dankest.llc.
 *
 *********************************************************************/

const INVALID_REQUEST = -32600;
const METHOD_NOT_FOUND = -32601;
const INTERNAL_ERROR = -32603;

function errorResponse(id, code, message, data) {
    const error = { code, message };
    if (data !== undefined) error.data = data;
    return { jsonrpc: '2.0', id, error };
}

function isValidId(id) {
    return id === null || typeof id === 'string' || (typeof id === 'number' && Number.isFinite(id));
}

function responseId(rpc) {
    if (!rpc || typeof rpc !== 'object' || Array.isArray(rpc)) return null;
    if (!Object.hasOwn(rpc, 'id') || !isValidId(rpc.id)) return null;
    return rpc.id;
}

function isValidRequest(rpc) {
    if (!rpc || typeof rpc !== 'object' || Array.isArray(rpc)) return false;
    if (rpc.jsonrpc !== '2.0' || typeof rpc.method !== 'string' || rpc.method.length === 0) return false;
    if (Object.hasOwn(rpc, 'id') && !isValidId(rpc.id)) return false;
    if (!Object.hasOwn(rpc, 'params')) return true;
    return rpc.params === null || typeof rpc.params === 'object';
}

function createMethodTable(controller) {
    const methods = Object.create(null);
    for (const [name, handler] of Object.entries(controller || {})) {
        if (typeof handler === 'function') methods[name] = handler;
    }
    return methods;
}

function handlerError(err) {
    const code = err && Number.isInteger(err.code) ? err.code : INTERNAL_ERROR;
    const message = err && typeof err.message === 'string' ? err.message : 'Internal error';
    const data =
        err && (typeof err === 'object' || typeof err === 'function') && Object.hasOwn(err, 'data')
            ? err.data
            : undefined;
    return { code, message, data };
}

async function executeRequest(rpc, methods, raw) {
    if (!isValidRequest(rpc)) return errorResponse(responseId(rpc), INVALID_REQUEST, 'Invalid Request');

    const notification = !Object.hasOwn(rpc, 'id');
    if (!Object.hasOwn(methods, rpc.method)) {
        return notification ? null : errorResponse(rpc.id, METHOD_NOT_FOUND, 'Method not found');
    }

    const params = rpc.params === undefined || rpc.params === null ? {} : rpc.params;
    try {
        const result = await methods[rpc.method](params, raw);
        return notification ? null : { jsonrpc: '2.0', id: rpc.id, result: result === undefined ? null : result };
    } catch (err) {
        if (notification) return null;
        const mapped = handlerError(err);
        return errorResponse(rpc.id, mapped.code, mapped.message, mapped.data);
    }
}

function createJsonRpcDispatcher(controller) {
    const methods = createMethodTable(controller);
    return async (req, res) => {
        try {
            const raw = { req, res };
            if (Array.isArray(req.body)) {
                if (req.body.length === 0) {
                    return res.json(errorResponse(null, INVALID_REQUEST, 'Invalid Request'));
                }
                const replies = (await Promise.all(req.body.map((rpc) => executeRequest(rpc, methods, raw)))).filter(
                    (reply) => reply !== null,
                );
                return replies.length === 0 ? res.send() : res.json(replies);
            }

            const reply = await executeRequest(req.body, methods, raw);
            return reply === null ? res.send() : res.json(reply);
        } catch (err) {
            return res.json(errorResponse(null, INTERNAL_ERROR, 'Internal error'));
        }
    };
}

module.exports = { createJsonRpcDispatcher };
