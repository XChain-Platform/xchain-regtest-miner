/*********************************************************************
 *
 * Copyright © 2025-2026 Dankest, LLC
 * Based on XChain Platform by Dankest, LLC - https://dankest.llc
 *
 * SPDX-License-Identifier: AGPL-3.0-or-later
 *
 * This file is part of XChain Platform. Licensed under the GNU Affero
 * General Public License v3.0 or later; see LICENSE.md. A commercial
 * license (without AGPL source-disclosure terms) is available -
 * contact legal@dankest.llc.
 *
 **********************************************************************
 * Shared prettier options for the xchain-* service repos: the formatting half
 * of the style, beside eslint.config.shared.js, which holds the naming and
 * structure half. Prettier owns whitespace, quotes, semicolons and wrapping;
 * eslint owns nothing of those, so the two never disagree.
 *
 * This is the platform's master copy. A repo vendors it by COPY as its own
 * prettier.config.js (a public clone has no ../claude to import from) and adds
 * prettier to devDependencies in the same commit. The rollout order, the paths
 * that must never be reformatted and the .git-blame-ignore-revs step are in
 * prettier-rollout.md beside this file.
 */
'use strict';

module.exports = {
    printWidth: 120,
    tabWidth: 4,
    useTabs: false,
    semi: true,
    singleQuote: true,
    quoteProps: 'as-needed',
    trailingComma: 'all',
    bracketSpacing: true,
    arrowParens: 'always',
    endOfLine: 'lf',
};
