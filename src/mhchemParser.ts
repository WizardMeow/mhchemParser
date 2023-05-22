/*!
 *************************************************************************
 *
 *  mhchemParser.ts
 *  4.1.2
 *
 *  Parser for the \ce command and \pu command for MathJax and Co.
 *
 *  mhchem's \ce is a tool for writing beautiful chemical equations easily.
 *  mhchem's \pu is a tool for writing physical units easily.
 *
 *  ----------------------------------------------------------------------
 *
 *  Copyright (c) 2015-2023 Martin Hensel
 *
 *  Licensed under the Apache License, Version 2.0 (the "License");
 *  you may not use this file except in compliance with the License.
 *  You may obtain a copy of the License at
 *
 *      http://www.apache.org/licenses/LICENSE-2.0
 *
 *  Unless required by applicable law or agreed to in writing, software
 *  distributed under the License is distributed on an "AS IS" BASIS,
 *  WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 *  See the License for the specific language governing permissions and
 *  limitations under the License.
 *
 *  ----------------------------------------------------------------------
 *
 *  https://github.com/mhchem/mhchemParser
 *
 */

export class mhchemParser {
	static toTex(input: string, type: "tex" | "ce" | "pu"): string {
		return _mhchemTexify.go(_mhchemParser.go(input, type), type !== "tex");
	}
}

//
// Coding Style
//   - use '' for identifiers that can by minified/uglified
//   - use "" for strings that need to stay untouched

//
// Helper funtion: _mhchemCreateTransitions
// convert  { 'letter': { 'state': { action_: 'output' } } }  to  { 'state' => [ { pattern: 'letter', task: { action_: [{type_: 'output'}] } } ] }
// with expansion of 'a|b' to 'a' and 'b' (at 2 places)
//
function _mhchemCreateTransitions(o: TransitionsRaw): Transitions {
	let pattern: PatternName, state: StateNameCombined;
	//
	// 1. Collect all states
	//
	let transitions: Transitions = {};
	for (pattern in o) {
		for (state in o[pattern]) {
			let stateArray = state.split("|") as StateName[];
			o[pattern][state].stateArray = stateArray;
			for (let i=0; i<stateArray.length; i++) {
				transitions[stateArray[i]] = [];
			}
		}
	}
	//
	// 2. Fill states
	//
	for (pattern in o) {
		for (state in o[pattern]) {
			let stateArray = o[pattern as PatternName][state].stateArray || [];
			for (let i=0; i<stateArray.length; i++) {
				//
				// 2a. Normalize actions into array:  'text=' ==> [{type_:'text='}]
				// (Note to myself: Resolving the function here would be problematic. It would need .bind (for *this*) and currying (for *option*).)
				//
				const p = o[pattern as PatternName][state];
				p.action_ = [].concat(p.action_);
				for (let k=0; k<p.action_.length; k++) {
					if (typeof p.action_[k] === "string") {
						p.action_[k] = { type_: p.action_[k] } as ActionNameWithParameter<ActionNameUsingMString>;
					}
				}
				//
				// 2.b Multi-insert
				//
				const patternArray = pattern.split("|") as PatternName[];
				for (let j=0; j<patternArray.length; j++) {
					if (stateArray[i] === '*') {  // insert into all
						let t: StateName;
						for (t in transitions) {
							transitions[t].push({ pattern: patternArray[j], task: p } as Transition);
						}
					} else {
						transitions[stateArray[i]].push({ pattern: patternArray[j], task: p } as Transition);
					}
				}
			}
		}
	}
	return transitions;
};

const _mhchemParser: MhchemParser = {
	//
	// Parses mhchem \ce syntax
	//
	// Call like
	//   go("H2O");
	//
	go: function (input, stateMachine) {
		if (!input) { return []; }
		if (stateMachine === undefined) { stateMachine = 'ce'; }
		let state: StateName = '0';
		let buffer: Buffer = {};
		buffer['parenthesisLevel'] = 0;

		input = input.replace(/\n/g, " ");
		input = input.replace(/[\u2212\u2013\u2014\u2010]/g, "-");
		input = input.replace(/[\u2026]/g, "...");

		//
		// Looks through _mhchemParser.transitions, to execute a matching action
		// (recursive)
		//
		let lastInput;
		let watchdog = 10;
		let output: Parsed[] = [];
		while (true) {
			if (lastInput !== input) {
				watchdog = 10;
				lastInput = input;
			} else {
				watchdog--;
			}
			//
			// Find actions in transition table
			//
			let machine = _mhchemParser.stateMachines[stateMachine];
			let t: Transition[] = machine.transitions[state] || machine.transitions['*'];
			iterateTransitions:
			for (let i=0; i<t.length; i++) {
				let matches = _mhchemParser.patterns.match_(t[i].pattern, input);
				if (matches) {
					//
					// Execute actions
					//
					const task = t[i].task;
					for (let iA=0; iA<task.action_.length; iA++) {
						let o: undefined | Parsed | Parsed[];
						//
						// Find and execute action
						//
						if (machine.actions[task.action_[iA].type_]) {
							o = machine.actions[task.action_[iA].type_](buffer, matches.match_ as any, task.action_[iA].option);
						} else if (_mhchemParser.actions[task.action_[iA].type_]) {
							o = _mhchemParser.actions[task.action_[iA].type_](buffer, matches.match_ as any, task.action_[iA].option);
						} else {
							throw ["MhchemBugA", "mhchem bug A. Please report. (" + task.action_[iA].type_ + ")"];  // Trying to use non-existing action
						}
						//
						// Add output
						//
						_mhchemParser.concatArray(output, o);
					}
					//
					// Set next state,
					// Shorten input,
					// Continue with next character
					//   (= apply only one transition per position)
					//
					state = task.nextState || state;
					if (input.length > 0) {
						if (!task.revisit) {
							input = matches.remainder;
						}
						if (!task.toContinue) {
							break iterateTransitions;
						}
					} else {
						return output;
					}
				}
			}
			//
			// Prevent infinite loop
			//
			if (watchdog <= 0) {
				throw ["MhchemBugU", "mhchem bug U. Please report."];  // Unexpected character
			}
		}
	},
	concatArray: function (a, b) {
		if (b) {
			if (Array.isArray(b)) {
				for (let iB=0; iB<b.length; iB++) {  // a.push(...b); is slower
					a.push(b[iB]);
				}
			} else {
				a.push(b);
			}
		}
	},

	patterns: {
		//
		// Matching patterns
		// either regexps or function that return null or {match_:"a", remainder:"bc"}
		//
		patterns: {
			// property names must not look like integers ("2") for correct property traversal order, later on
			'empty': /^$/,
			'else': /^./,
			'else2': /^./,
			'space': /^\s/,
			'space A': /^\s(?=[A-Z\\$])/,
			'space$': /^\s$/,
			'a-z': /^[a-z]/,
			'x': /^x/,
			'x$': /^x$/,
			'i$': /^i$/,
			'letters': /^(?:[a-zA-Z\u03B1-\u03C9\u0391-\u03A9?@]|(?:\\(?:alpha|beta|gamma|delta|epsilon|zeta|eta|theta|iota|kappa|lambda|mu|nu|xi|omicron|pi|rho|sigma|tau|upsilon|phi|chi|psi|omega|Gamma|Delta|Theta|Lambda|Xi|Pi|Sigma|Upsilon|Phi|Psi|Omega)(?:\s+|\{\}|(?![a-zA-Z]))))+/,
			'\\greek': /^\\(?:alpha|beta|gamma|delta|epsilon|zeta|eta|theta|iota|kappa|lambda|mu|nu|xi|omicron|pi|rho|sigma|tau|upsilon|phi|chi|psi|omega|Gamma|Delta|Theta|Lambda|Xi|Pi|Sigma|Upsilon|Phi|Psi|Omega)(?:\s+|\{\}|(?![a-zA-Z]))/,
			'one lowercase latin letter $': /^(?:([a-z])(?:$|[^a-zA-Z]))$/,
			'$one lowercase latin letter$ $': /^\$(?:([a-z])(?:$|[^a-zA-Z]))\$$/,
			'one lowercase greek letter $': /^(?:\$?[\u03B1-\u03C9]\$?|\$?\\(?:alpha|beta|gamma|delta|epsilon|zeta|eta|theta|iota|kappa|lambda|mu|nu|xi|omicron|pi|rho|sigma|tau|upsilon|phi|chi|psi|omega)\s*\$?)(?:\s+|\{\}|(?![a-zA-Z]))$/,
			'digits': /^[0-9]+/,
			'-9.,9': /^[+\-]?(?:[0-9]+(?:[,.][0-9]+)?|[0-9]*(?:\.[0-9]+))/,
			'-9.,9 no missing 0': /^[+\-]?[0-9]+(?:[.,][0-9]+)?/,
			'(-)(9.,9)(e)(99)': function (input) {
				const match = input.match(/^(\+\-|\+\/\-|\+|\-|\\pm\s?)?([0-9]+(?:[,.][0-9]+)?|[0-9]*(?:\.[0-9]+))?(\((?:[0-9]+(?:[,.][0-9]+)?|[0-9]*(?:\.[0-9]+))\))?(?:(?:([eE])|\s*(\*|x|\\times|\u00D7)\s*10\^)([+\-]?[0-9]+|\{[+\-]?[0-9]+\}))?/);
				if (match && match[0]) {  // could also match ""
					return { match_: match.slice(1), remainder: input.substr(match[0].length) };
				}
				return null;
			},
			'(-)(9)^(-9)': /^(\+\-|\+\/\-|\+|\-|\\pm\s?)?([0-9]+(?:[,.][0-9]+)?|[0-9]*(?:\.[0-9]+)?)\^([+\-]?[0-9]+|\{[+\-]?[0-9]+\})/,
			'state of aggregation $': function (input) {  // ... or crystal system
				const a = _mhchemParser.patterns.findObserveGroups(input, "", /^\([a-z]{1,3}(?=[\),])/, ")", "");  // (aq), (aq,$\infty$), (aq, sat)
				if (a  &&  a.remainder.match(/^($|[\s,;\)\]\}])/)) { return a; }  //  AND end of 'phrase'
				const match = input.match(/^(?:\((?:\\ca\s?)?\$[amothc]\$\))/);  // OR crystal system ($o$) (\ca$c$)
				if (match) {
					return { match_: match[0], remainder: input.substr(match[0].length) };
				}
				return null;
			} as PatternFunction<string>,
			'_{(state of aggregation)}$': /^_\{(\([a-z]{1,3}\))\}/,
			'{[(': /^(?:\\\{|\[|\()/,
			')]}': /^(?:\)|\]|\\\})/,
			', ': /^[,;]\s*/,
			',': /^[,;]/,
			'.': /^[.]/,
			'. __* ': /^([.\u22C5\u00B7\u2022]|[*])\s*/,
			'...': /^\.\.\.(?=$|[^.])/,
			'^{(...)}': function (input) { return _mhchemParser.patterns.findObserveGroups(input, "^{", "", "", "}"); } as PatternFunction<string>,
			'^($...$)': function (input) { return _mhchemParser.patterns.findObserveGroups(input, "^", "$", "$", ""); } as PatternFunction<string>,
			'^a': /^\^([0-9]+|[^\\_])/,
			'^\\x{}{}': function (input) { return _mhchemParser.patterns.findObserveGroups(input, "^", /^\\[a-zA-Z]+\{/, "}", "", "", "{", "}", "", true); } as PatternFunction<string>,
			'^\\x{}': function (input) { return _mhchemParser.patterns.findObserveGroups(input, "^", /^\\[a-zA-Z]+\{/, "}", ""); } as PatternFunction<string>,
			'^\\x': /^\^(\\[a-zA-Z]+)\s*/,
			'^(-1)': /^\^(-?\d+)/,
			'\'': /^'/,
			'_{(...)}': function (input) { return _mhchemParser.patterns.findObserveGroups(input, "_{", "", "", "}"); } as PatternFunction<string>,
			'_($...$)': function (input) { return _mhchemParser.patterns.findObserveGroups(input, "_", "$", "$", ""); } as PatternFunction<string>,
			'_9': /^_([+\-]?[0-9]+|[^\\])/,
			'_\\x{}{}': function (input) { return _mhchemParser.patterns.findObserveGroups(input, "_", /^\\[a-zA-Z]+\{/, "}", "", "", "{", "}", "", true); } as PatternFunction<string>,
			'_\\x{}': function (input) { return _mhchemParser.patterns.findObserveGroups(input, "_", /^\\[a-zA-Z]+\{/, "}", ""); } as PatternFunction<string>,
			'_\\x': /^_(\\[a-zA-Z]+)\s*/,
			'^_': /^(?:\^(?=_)|\_(?=\^)|[\^_]$)/,
			'{}^': /^\{\}(?=\^)/,
			'{}': /^\{\}/,
			'{...}': function (input) { return _mhchemParser.patterns.findObserveGroups(input, "", "{", "}", ""); } as PatternFunction<string>,
			'{(...)}': function (input) { return _mhchemParser.patterns.findObserveGroups(input, "{", "", "", "}"); } as PatternFunction<string>,
			'$...$': function (input) { return _mhchemParser.patterns.findObserveGroups(input, "", "$", "$", ""); } as PatternFunction<string>,
			'${(...)}$__$(...)$': function (input) {
				return _mhchemParser.patterns.findObserveGroups(input, "${", "", "", "}$") || _mhchemParser.patterns.findObserveGroups(input, "$", "", "", "$");
			} as PatternFunction<string>,
			'=<>': /^[=<>]/,
			'#': /^[#\u2261]/,
			'+': /^\+/,
			'-$': /^-(?=[\s_},;\]/]|$|\([a-z]+\))/,  // -space -, -; -] -/ -$ -state-of-aggregation
			'-9': /^-(?=[0-9])/,
			'- orbital overlap': /^-(?=(?:[spd]|sp)(?:$|[\s,;\)\]\}]))/,
			'-': /^-/,
			'pm-operator': /^(?:\\pm|\$\\pm\$|\+-|\+\/-)/,
			'operator': /^(?:\+|(?:[\-=<>]|<<|>>|\\approx|\$\\approx\$)(?=\s|$|-?[0-9]))/,
			'arrowUpDown': /^(?:v|\(v\)|\^|\(\^\))(?=$|[\s,;\)\]\}])/,
			'\\bond{(...)}': function (input) { return _mhchemParser.patterns.findObserveGroups(input, "\\bond{", "", "", "}"); } as PatternFunction<string>,
			'->': /^(?:<->|<-->|->|<-|<=>>|<<=>|<=>|[\u2192\u27F6\u21CC])/,
			'CMT': /^[CMT](?=\[)/,
			'[(...)]': function (input) { return _mhchemParser.patterns.findObserveGroups(input, "[", "", "", "]"); } as PatternFunction<string>,
			'1st-level escape': /^(&|\\\\|\\hline)\s*/,
			'\\,': /^(?:\\[,\ ;:])/,  // \\x - but output no space before
			'\\x{}{}': function (input) { return _mhchemParser.patterns.findObserveGroups(input, "", /^\\[a-zA-Z]+\{/, "}", "", "", "{", "}", "", true); } as PatternFunction<string>,
			'\\x{}': function (input) { return _mhchemParser.patterns.findObserveGroups(input, "", /^\\[a-zA-Z]+\{/, "}", ""); } as PatternFunction<string>,
			'\\ca': /^\\ca(?:\s+|(?![a-zA-Z]))/,
			'\\x': /^(?:\\[a-zA-Z]+\s*|\\[_&{}%])/,
			'orbital': /^(?:[0-9]{1,2}[spdfgh]|[0-9]{0,2}sp)(?=$|[^a-zA-Z])/,  // only those with numbers in front, because the others will be formatted correctly anyway
			'others': /^[\/~|]/,
			'\\frac{(...)}': function (input) { return _mhchemParser.patterns.findObserveGroups(input, "\\frac{", "", "", "}", "{", "", "", "}"); } as PatternFunction<string[]>,
			'\\overset{(...)}': function (input) { return _mhchemParser.patterns.findObserveGroups(input, "\\overset{", "", "", "}", "{", "", "", "}"); } as PatternFunction<string[]>,
			'\\underset{(...)}': function (input) { return _mhchemParser.patterns.findObserveGroups(input, "\\underset{", "", "", "}", "{", "", "", "}"); } as PatternFunction<string[]>,
			'\\underbrace{(...)}': function (input) { return _mhchemParser.patterns.findObserveGroups(input, "\\underbrace{", "", "", "}_", "{", "", "", "}"); } as PatternFunction<string[]>,
			'\\color{(...)}': function (input) { return _mhchemParser.patterns.findObserveGroups(input, "\\color{", "", "", "}"); } as PatternFunction<string>,
			'\\color{(...)}{(...)}': function (input) {
				return _mhchemParser.patterns.findObserveGroups(input, "\\color{", "", "", "}", "{", "", "", "}") ||
					_mhchemParser.patterns.findObserveGroups(input, "\\color", "\\", "", /^(?=\{)/, "{", "", "", "}");
			} as PatternFunction<string[]>,
			'\\ce{(...)}': function (input) { return _mhchemParser.patterns.findObserveGroups(input, "\\ce{", "", "", "}"); } as PatternFunction<string>,
			'\\pu{(...)}': function (input) { return _mhchemParser.patterns.findObserveGroups(input, "\\pu{", "", "", "}"); } as PatternFunction<string>,
			'oxidation$': /^(?:[+-][IVX]+|(?:\\pm|\$\\pm\$|\+-|\+\/-)\s*0)$/,  // -IV to +IX, +-0 // "0" could be oxidation or charge - but renders the same
			'd-oxidation$': /^(?:[+-]?[IVX]+|(?:\\pm|\$\\pm\$|\+-|\+\/-)\s*0)$/,
			'1/2$': /^[+\-]?(?:[0-9]+|\$[a-z]\$|[a-z])\/[0-9]+(?:\$[a-z]\$|[a-z])?$/,
			'amount': function (input) {
				let match;
				// e.g. 2, 0.5, 1/2, -2, n/2, +;  $a$ could be added later in parsing
				match = input.match(/^(?:(?:(?:\([+\-]?[0-9]+\/[0-9]+\)|[+\-]?(?:[0-9]+|\$[a-z]\$|[a-z])\/[0-9]+|[+\-]?[0-9]+[.,][0-9]+|[+\-]?\.[0-9]+|[+\-]?[0-9]+)(?:[a-z](?=\s*[A-Z]))?)|[+\-]?[a-z](?=\s*[A-Z])|\+(?!\s))/);
				if (match) {
					return { match_: match[0], remainder: input.substr(match[0].length) };
				}
				const a = _mhchemParser.patterns.findObserveGroups(input, "", "$", "$", "") as MatchResult<string>;
				if (a) {  // e.g. $2n-1$, $-$
					match = a.match_.match(/^\$(?:\(?[+\-]?(?:[0-9]*[a-z]?[+\-])?[0-9]*[a-z](?:[+\-][0-9]*[a-z]?)?\)?|\+|-)\$$/);
					if (match) {
						return { match_: match[0], remainder: input.substr(match[0].length) };
					}
				}
				return null;
			},
			'amount2': function (input) { return this['amount'](input); },
			'(KV letters),': /^(?:[A-Z][a-z]{0,2}|i)(?=,)/,
			'formula$': function (input) {
				if (input.match(/^\([a-z]+\)$/)) { return null; }  // state of aggregation = no formula
				const match = input.match(/^(?:[a-z]|(?:[0-9\ \+\-\,\.\(\)]+[a-z])+[0-9\ \+\-\,\.\(\)]*|(?:[a-z][0-9\ \+\-\,\.\(\)]+)+[a-z]?)$/);
				if (match) {
					return { match_: match[0], remainder: input.substr(match[0].length) };
				}
				return null;
			},
			'uprightEntities': /^(?:pH|pOH|pC|pK|iPr|iBu)(?=$|[^a-zA-Z])/,
			'/': /^\s*(\/)\s*/,
			'//': /^\s*(\/\/)\s*/,
			'*': /^\s*[*.]\s*/
		},
		findObserveGroups: function (input, begExcl, begIncl, endIncl, endExcl, beg2Excl, beg2Incl, end2Incl, end2Excl, combine) {
			const _match = function (input: string, pattern: string | RegExp) : string | string[] | null {
				if (typeof pattern === "string") {
					if (input.indexOf(pattern) !== 0) { return null; }
					return pattern;
				} else {
					const match = input.match(pattern);
					if (!match) { return null; }
					return match[0];
				}
			};
			const _findObserveGroups = function (input: string, i: number, endChars: string | RegExp): {endMatchBegin: number, endMatchEnd: number} | null {
				let braces = 0;
				while (i < input.length) {
					let a = input.charAt(i);
					const match = _match(input.substr(i), endChars);
					if (match !== null  &&  braces === 0) {
						return { endMatchBegin: i, endMatchEnd: i + match.length };
					} else if (a === "{") {
						braces++;
					} else if (a === "}") {
						if (braces === 0) {
							throw ["ExtraCloseMissingOpen", "Extra close brace or missing open brace"];
						} else {
							braces--;
						}
					}
					i++;
				}
				if (braces > 0) {
					return null;
				}
				return null;
			};
			let match = _match(input, begExcl);
			if (match === null) { return null; }
			input = input.substr(match.length);
			match = _match(input, begIncl);
			if (match === null) { return null; }
			const e = _findObserveGroups(input, match.length, endIncl || endExcl);
			if (e === null) { return null; }
			const match1 = input.substring(0, (endIncl ? e.endMatchEnd : e.endMatchBegin));
			if (!(beg2Excl || beg2Incl)) {
				return {
					match_: match1,
					remainder: input.substr(e.endMatchEnd)
				};
			} else {
				const group2 = this.findObserveGroups(input.substr(e.endMatchEnd), beg2Excl, beg2Incl, end2Incl, end2Excl);
				if (group2 === null) { return null; }
				const matchRet: string[] = [match1, group2.match_];
				return {
					match_: (combine ? matchRet.join("") : matchRet),
					remainder: group2.remainder
				};
			}
		},

		//
		// Matching function
		// e.g. match("a", input) will look for the regexp called "a" and see if it matches
		// returns null or {match_:"a", remainder:"bc"}
		//
		match_: function (m, input) {
			const pattern = _mhchemParser.patterns.patterns[m];
			if (pattern === undefined) {
				throw ["MhchemBugP", "mhchem bug P. Please report. (" + m + ")"];  // Trying to use non-existing pattern
			} else if (typeof pattern === "function") {
				return (_mhchemParser.patterns.patterns[m] as unknown as PatternFunction<string | string[]>)(input);  // cannot use cached variable pattern here, because some pattern functions need this===mhchemParser
			} else {  // RegExp
				const match = input.match(pattern);
				if (match) {
					if (match.length > 2) {
						return { match_: match.slice(1), remainder: input.substr(match[0].length) };
					} else {
						return { match_: match[1] || match[0], remainder: input.substr(match[0].length) };
					}
				}
				return null;
			}
		}
	},

	//
	// Generic state machine actions
	//
	actions: {
		'a=': function (buffer, m) { buffer.a = (buffer.a || "") + m; return undefined; },
		'b=': function (buffer, m) { buffer.b = (buffer.b || "") + m; return undefined; },
		'p=': function (buffer, m) { buffer.p = (buffer.p || "") + m; return undefined; },
		'o=': function (buffer, m) { buffer.o = (buffer.o || "") + m; return undefined; },
		'o=+p1': function (buffer, _m, a: string) { buffer.o = (buffer.o || "") + a; return undefined; },
		'q=': function (buffer, m) { buffer.q = (buffer.q || "") + m; return undefined; },
		'd=': function (buffer, m) { buffer.d = (buffer.d || "") + m; return undefined; },
		'rm=': function (buffer, m) { buffer.rm = (buffer.rm || "") + m; return undefined; },
		'text=': function (buffer, m) { buffer.text_ = (buffer.text_ || "") + m; return undefined; },
		'insert': function (_buffer, _m, a: string) { return { type_: a } as Parsed; },
		'insert+p1': function (_buffer, m, a) { return { type_: a, p1: m } as Parsed; },
		'insert+p1+p2': function (_buffer, m, a) { return { type_: a, p1: m[0], p2: m[1] } as Parsed; },
		'copy': function (_buffer, m) { return m; },
		'write': function (_buffer, _m, a: string) { return a; },
		'rm': function (_buffer, m) { return { type_: 'rm', p1: m }; },
		'text': function (_buffer, m) { return _mhchemParser.go(m, 'text'); },
		'tex-math': function (_buffer, m) { return _mhchemParser.go(m, 'tex-math'); },
		'tex-math tight': function (_buffer, m) { return _mhchemParser.go(m, 'tex-math tight'); },
		'bond': function (_buffer, m: BondName, k: BondName) { return { type_: 'bond', kind_: k || m }; },
		'color0-output': function (_buffer, m) { return { type_: 'color0', color: m }; },
		'ce': function (_buffer, m) { return _mhchemParser.go(m, 'ce'); },
		'pu': function (_buffer, m) { return _mhchemParser.go(m, 'pu'); },
		'1/2': function (_buffer, m) {
			let ret: Parsed[] = [];
			if (m.match(/^[+\-]/)) {
				ret.push(m.substr(0, 1));
				m = m.substr(1);
			}
			const n = m.match(/^([0-9]+|\$[a-z]\$|[a-z])\/([0-9]+)(\$[a-z]\$|[a-z])?$/);
			n[1] = n[1].replace(/\$/g, "");
			ret.push({ type_: 'frac', p1: n[1], p2: n[2] });
			if (n[3]) {
				n[3] = n[3].replace(/\$/g, "");
				ret.push({ type_: 'tex-math', p1: n[3] });
			}
			return ret;
		},
		'9,9': function (_buffer, m) { return _mhchemParser.go(m, '9,9'); }
	},
//
// Definition of state machines
//
	stateMachines: {
	//
	// TeX state machine
	//
	'tex': {
		transitions: _mhchemCreateTransitions({
			'empty': {
				'0': { action_: 'copy' } },
			'\\ce{(...)}': {
				'0': { action_: [ { type_: 'write', option: "{" }, 'ce', { type_: 'write', option: "}" }] } },
			'\\pu{(...)}': {
				'0': { action_: [ { type_: 'write', option: "{" }, 'pu', { type_: 'write', option: "}" }] } },
			'else': {
				'0': { action_: 'copy' } },
		}),
		actions: {}
	},
	//
	// \ce state machines
	//
	//#region ce
	'ce': {  // main parser
		transitions: _mhchemCreateTransitions({
			'empty': {
				'*': { action_: 'output' } },
			'else':  {
				'0|1|2': { action_: 'beginsWithBond=false', revisit: true, toContinue: true } },
			'oxidation$': {
				'0': { action_: 'oxidation-output' } },
			'CMT': {
				'r': { action_: 'rdt=', nextState: 'rt' },
				'rd': { action_: 'rqt=', nextState: 'rdt' } },
			'arrowUpDown': {
				'0|1|2|as': { action_: [ 'sb=false', 'output', 'operator' ], nextState: '1' } },
			'uprightEntities': {
				'0|1|2': { action_: [ 'o=', 'output' ], nextState: '1' } },
			'orbital': {
				'0|1|2|3': { action_: 'o=', nextState: 'o' } },
			'->': {
				'0|1|2|3': { action_: 'r=', nextState: 'r' },
				'a|as': { action_: [ 'output', 'r=' ], nextState: 'r' },
				'*': { action_: [ 'output', 'r=' ], nextState: 'r' } },
			'+': {
				'o': { action_: 'd= kv',  nextState: 'd' },
				'd|D': { action_: 'd=', nextState: 'd' },
				'q': { action_: 'd=',  nextState: 'qd' },
				'qd|qD': { action_: 'd=', nextState: 'qd' },
				'dq': { action_: [ 'output', 'd=' ], nextState: 'd' },
				'3': { action_: [ 'sb=false', 'output', 'operator' ], nextState: '0' } },
			'amount': {
				'0|2': { action_: 'a=', nextState: 'a' } },
			'pm-operator': {
				'0|1|2|a|as': { action_: [ 'sb=false', 'output', { type_: 'operator', option: '\\pm' } ], nextState: '0' } },
			'operator': {
				'0|1|2|a|as': { action_: [ 'sb=false', 'output', 'operator' ], nextState: '0' } },
			'-$': {
				'o|q': { action_: [ 'charge or bond', 'output' ],  nextState: 'qd' },
				'd': { action_: 'd=', nextState: 'd' },
				'D': { action_: [ 'output', { type_: 'bond', option: "-" } ], nextState: '3' },
				'q': { action_: 'd=',  nextState: 'qd' },
				'qd': { action_: 'd=', nextState: 'qd' },
				'qD|dq': { action_: [ 'output', { type_: 'bond', option: "-" } ], nextState: '3' } },
			'-9': {
				'3|o': { action_: [ 'output', { type_: 'insert', option: 'hyphen' } ], nextState: '3' } },
			'- orbital overlap': {
				'o': { action_: [ 'output', { type_: 'insert', option: 'hyphen' } ], nextState: '2' },
				'd': { action_: [ 'output', { type_: 'insert', option: 'hyphen' } ], nextState: '2' } },
			'-': {
				'0|1|2': { action_: [ { type_: 'output', option: 1 }, 'beginsWithBond=true', { type_: 'bond', option: "-" } ], nextState: '3' },
				'3': { action_: { type_: 'bond', option: "-" } },
				'a': { action_: [ 'output', { type_: 'insert', option: 'hyphen' } ], nextState: '2' },
				'as': { action_: [ { type_: 'output', option: 2 }, { type_: 'bond', option: "-" } ], nextState: '3' },
				'b': { action_: 'b=' },
				'o': { action_: { type_: '- after o/d', option: false }, nextState: '2' },
				'q': { action_: { type_: '- after o/d', option: false }, nextState: '2' },
				'd|qd|dq': { action_: { type_: '- after o/d', option: true }, nextState: '2' },
				'D|qD|p': { action_: [ 'output', { type_: 'bond', option: "-" } ], nextState: '3' } },
			'amount2': {
				'1|3': { action_: 'a=', nextState: 'a' } },
			'letters': {
				'0|1|2|3|a|as|b|p|bp|o': { action_: 'o=', nextState: 'o' },
				'q|dq': { action_: ['output', 'o='], nextState: 'o' },
				'd|D|qd|qD': { action_: 'o after d', nextState: 'o' } },
			'digits': {
				'o': { action_: 'q=', nextState: 'q' },
				'd|D': { action_: 'q=', nextState: 'dq' },
				'q': { action_: [ 'output', 'o=' ], nextState: 'o' },
				'a': { action_: 'o=', nextState: 'o' } },
			'space A': {
				'b|p|bp': { action_: [] } },
			'space': {
				'a': { action_: [], nextState: 'as' },
				'0': { action_: 'sb=false' },
				'1|2': { action_: 'sb=true' },
				'r|rt|rd|rdt|rdq': { action_: 'output', nextState: '0' },
				'*': { action_: [ 'output', 'sb=true' ], nextState: '1'} },
			'1st-level escape': {
				'1|2': { action_: [ 'output', { type_: 'insert+p1', option: '1st-level escape' } ] },
				'*': { action_: [ 'output', { type_: 'insert+p1', option: '1st-level escape' } ], nextState: '0' } },
			'[(...)]': {
				'r|rt': { action_: 'rd=', nextState: 'rd' },
				'rd|rdt': { action_: 'rq=', nextState: 'rdq' } },
			'...': {
				'o|d|D|dq|qd|qD': { action_: [ 'output', { type_: 'bond', option: "..." } ], nextState: '3' },
				'*': { action_: [ { type_: 'output', option: 1 }, { type_: 'insert', option: 'ellipsis' } ], nextState: '1' } },
			'. __* ': {
				'*': { action_: [ 'output', { type_: 'insert', option: 'addition compound' } ], nextState: '1' } },
			'state of aggregation $': {
				'*': { action_: [ 'output', 'state of aggregation' ], nextState: '1' } },
			'{[(': {
				'a|as|o': { action_: [ 'o=', 'output', 'parenthesisLevel++' ], nextState: '2' },
				'0|1|2|3': { action_: [ 'o=', 'output', 'parenthesisLevel++' ], nextState: '2' },
				'*': { action_: [ 'output', 'o=', 'output', 'parenthesisLevel++' ], nextState: '2' } },
			')]}': {
				'0|1|2|3|b|p|bp|o': { action_: [ 'o=', 'parenthesisLevel--' ], nextState: 'o' },
				'a|as|d|D|q|qd|qD|dq': { action_: [ 'output', 'o=', 'parenthesisLevel--' ], nextState: 'o' } },
			', ': {
				'*': { action_: [ 'output', 'comma' ], nextState: '0' } },
			'^_': {  // ^ and _ without a sensible argument
				'*': { action_: [] } },
			'^{(...)}|^($...$)': {
				'0|1|2|as': { action_: 'b=', nextState: 'b' },
				'p': { action_: 'b=', nextState: 'bp' },
				'3|o': { action_: 'd= kv', nextState: 'D' },
				'q': { action_: 'd=', nextState: 'qD' },
				'd|D|qd|qD|dq': { action_: [ 'output', 'd=' ], nextState: 'D' } },
			'^a|^\\x{}{}|^\\x{}|^\\x|\'': {
				'0|1|2|as': { action_: 'b=', nextState: 'b' },
				'p': { action_: 'b=', nextState: 'bp' },
				'3|o': { action_: 'd= kv', nextState: 'd' },
				'q': { action_: 'd=', nextState: 'qd' },
				'd|qd|D|qD': { action_: 'd=' },
				'dq': { action_: [ 'output', 'd=' ], nextState: 'd' } },
			'_{(state of aggregation)}$': {
				'd|D|q|qd|qD|dq': { action_: [ 'output', 'q=' ], nextState: 'q' } },
			'_{(...)}|_($...$)|_9|_\\x{}{}|_\\x{}|_\\x': {
				'0|1|2|as': { action_: 'p=', nextState: 'p' },
				'b': { action_: 'p=', nextState: 'bp' },
				'3|o': { action_: 'q=', nextState: 'q' },
				'd|D': { action_: 'q=', nextState: 'dq' },
				'q|qd|qD|dq': { action_: [ 'output', 'q=' ], nextState: 'q' } },
			'=<>': {
				'0|1|2|3|a|as|o|q|d|D|qd|qD|dq': { action_: [ { type_: 'output', option: 2 }, 'bond' ], nextState: '3' } },
			'#': {
				'0|1|2|3|a|as|o': { action_: [ { type_: 'output', option: 2 }, { type_: 'bond', option: "#" } ], nextState: '3' } },
			'{}^': {
				'*': { action_: [ { type_: 'output', option: 1 }, { type_: 'insert', option: 'tinySkip' } ],  nextState: '1' } },
			'{}': {
				'*': { action_: { type_: 'output', option: 1 },  nextState: '1' } },
			'{...}': {
				'0|1|2|3|a|as|b|p|bp': { action_: 'o=', nextState: 'o' },
				'o|d|D|q|qd|qD|dq': { action_: [ 'output', 'o=' ], nextState: 'o' } },
			'$...$': {
				'a': { action_: 'a=' },  // 2$n$
				'0|1|2|3|as|b|p|bp|o': { action_: 'o=', nextState: 'o' },  // not 'amount'
				'as|o': { action_: 'o=' },
				'q|d|D|qd|qD|dq': { action_: [ 'output', 'o=' ], nextState: 'o' } },
			'\\bond{(...)}': {
				'*': { action_: [ { type_: 'output', option: 2 }, 'bond' ], nextState: "3" } },
			'\\frac{(...)}': {
				'*': { action_: [ { type_: 'output', option: 1 }, 'frac-output' ], nextState: '3' } },
			'\\overset{(...)}': {
				'*': { action_: [ { type_: 'output', option: 2 }, 'overset-output' ], nextState: '3' } },
			'\\underset{(...)}': {
				'*': { action_: [ { type_: 'output', option: 2 }, 'underset-output' ], nextState: '3' } },
			'\\underbrace{(...)}': {
				'*': { action_: [ { type_: 'output', option: 2 }, 'underbrace-output' ], nextState: '3' } },
			'\\color{(...)}{(...)}': {
				'*': { action_: [ { type_: 'output', option: 2 }, 'color-output' ], nextState: '3' } },
			'\\color{(...)}': {
				'*': { action_: [ { type_: 'output', option: 2 }, 'color0-output' ] } },
			'\\ce{(...)}': {
				'*': { action_: [ { type_: 'output', option: 2 }, 'ce' ], nextState: '3' } },
			'\\,': {
				'*': { action_: [ { type_: 'output', option: 1 }, 'copy' ], nextState: '1' } },
			'\\pu{(...)}': {
				'*': { action_: [ 'output', { type_: 'write', option: "{" }, 'pu', { type_: 'write', option: "}" } ], nextState: '3' } },
			'\\x{}{}|\\x{}|\\x': {
				'0|1|2|3|a|as|b|p|bp|o|c0': { action_: [ 'o=', 'output' ], nextState: '3' },
				'*': { action_: ['output', 'o=', 'output' ], nextState: '3' } },
			'others': {
				'*': { action_: [ { type_: 'output', option: 1 }, 'copy' ], nextState: '3' } },
			'else2': {
				'a': { action_: 'a to o', nextState: 'o', revisit: true },
				'as': { action_: [ 'output', 'sb=true' ], nextState: '1', revisit: true },
				'r|rt|rd|rdt|rdq': { action_: [ 'output' ], nextState: '0', revisit: true },
				'*': { action_: [ 'output', 'copy' ], nextState: '3' } }
		}),
		actions: {
			'o after d': function (buffer, m) {
				let ret;
				if ((buffer.d || "").match(/^[1-9][0-9]*$/)) {
					const tmp = buffer.d;
					buffer.d = undefined;
					ret = this['output'](buffer);
					ret.push({ type_: 'tinySkip' });
					buffer.b = tmp;
				} else {
					ret = this['output'](buffer);
				}
				_mhchemParser.actions['o='](buffer, m);
				return ret;
			},
			'd= kv': function (buffer, m) {
				buffer.d = m;
				buffer.dType = 'kv';
				return undefined;
			},
			'charge or bond': function (buffer, m): undefined | Parsed[] {
				if (buffer['beginsWithBond']) {
					let ret: Parsed[] = [];
					_mhchemParser.concatArray(ret, this['output'](buffer));
					_mhchemParser.concatArray(ret, _mhchemParser.actions['bond'](buffer, m, "-"));
					return ret;
				} else {
					buffer.d = m;
					return undefined;
				}
			},
			'- after o/d': function (buffer, m, isAfterD) {
				let c1 = _mhchemParser.patterns.match_('orbital', buffer.o || "");
				const c2 = _mhchemParser.patterns.match_('one lowercase greek letter $', buffer.o || "");
				const c3 = _mhchemParser.patterns.match_('one lowercase latin letter $', buffer.o || "");
				const c4 = _mhchemParser.patterns.match_('$one lowercase latin letter$ $', buffer.o || "");
				const hyphenFollows =  m==="-" && ( c1 && c1.remainder===""  ||  c2  ||  c3  ||  c4 );
				if (hyphenFollows && !buffer.a && !buffer.b && !buffer.p && !buffer.d && !buffer.q && !c1 && c3) {
					buffer.o = '$' + buffer.o + '$';
				}
				let ret: Parsed[] = [];
				if (hyphenFollows) {
					_mhchemParser.concatArray(ret, this['output'](buffer));
					ret.push({ type_: 'hyphen' });
				} else {
					c1 = _mhchemParser.patterns.match_('digits', buffer.d || "");
					if (isAfterD && c1 && c1.remainder==='') {
						_mhchemParser.concatArray(ret, _mhchemParser.actions['d='](buffer, m));
						_mhchemParser.concatArray(ret, this['output'](buffer));
					} else {
						_mhchemParser.concatArray(ret, this['output'](buffer));
						_mhchemParser.concatArray(ret, _mhchemParser.actions['bond'](buffer, m, "-"));
					}
				}
				return ret;
			},
			'a to o': function (buffer) {
				buffer.o = buffer.a;
				buffer.a = undefined;
				return undefined;
			},
			'sb=true': function (buffer) { buffer.sb = true; return undefined; },
			'sb=false': function (buffer) { buffer.sb = false; return undefined; },
			'beginsWithBond=true': function (buffer) { buffer['beginsWithBond'] = true; return undefined; },
			'beginsWithBond=false': function (buffer) { buffer['beginsWithBond'] = false; return undefined; },
			'parenthesisLevel++': function (buffer) { buffer['parenthesisLevel']++; return undefined; },
			'parenthesisLevel--': function (buffer) { buffer['parenthesisLevel']--; return undefined; },
			'state of aggregation': function (_buffer, m) {
				return { type_: 'state of aggregation', p1: _mhchemParser.go(m, 'o') };
			},
			'comma': function (buffer, m) {
				const a = m.replace(/\s*$/, '');
				const withSpace = (a !== m);
				if (withSpace  &&  buffer['parenthesisLevel'] === 0) {
					return { type_: 'comma enumeration L', p1: a };
				} else {
					return { type_: 'comma enumeration M', p1: a };
				}
			},
			'output': function (buffer, _m, entityFollows) {
				// entityFollows:
				//   undefined = if we have nothing else to output, also ignore the just read space (buffer.sb)
				//   1 = an entity follows, never omit the space if there was one just read before (can only apply to state 1)
				//   2 = 1 + the entity can have an amount, so output a\, instead of converting it to o (can only apply to states a|as)
				let ret: Parsed | Parsed[];
				if (!buffer.r) {
					ret = [];
					if (!buffer.a && !buffer.b && !buffer.p && !buffer.o && !buffer.q && !buffer.d && !entityFollows) {
						//ret = [];
					} else {
						if (buffer.sb) {
							ret.push({ type_: 'entitySkip' });
						}
						if (!buffer.o && !buffer.q && !buffer.d && !buffer.b && !buffer.p && entityFollows!==2) {
							buffer.o = buffer.a;
							buffer.a = undefined;
						} else if (!buffer.o && !buffer.q && !buffer.d && (buffer.b || buffer.p)) {
							buffer.o = buffer.a;
							buffer.d = buffer.b;
							buffer.q = buffer.p;
							buffer.a = buffer.b = buffer.p = undefined;
						} else {
							if (buffer.o && buffer.dType==='kv' && _mhchemParser.patterns.match_('d-oxidation$', buffer.d || "")) {
								buffer.dType = 'oxidation';
							} else if (buffer.o && buffer.dType==='kv' && !buffer.q) {
								buffer.dType = undefined;
							}
						}
						ret.push({
							type_: 'chemfive',
							a: _mhchemParser.go(buffer.a, 'a'),
							b: _mhchemParser.go(buffer.b, 'bd'),
							p: _mhchemParser.go(buffer.p, 'pq'),
							o: _mhchemParser.go(buffer.o, 'o'),
							q: _mhchemParser.go(buffer.q, 'pq'),
							d: _mhchemParser.go(buffer.d, (buffer.dType === 'oxidation' ? 'oxidation' : 'bd')),
							dType: buffer.dType
						});
					}
				} else {  // r
					let rd: Parsed[];
					if (buffer.rdt === 'M') {
						rd = _mhchemParser.go(buffer.rd, 'tex-math');
					} else if (buffer.rdt === 'T') {
						rd = [ { type_: 'text', p1: buffer.rd || "" } ];
					} else {
						rd = _mhchemParser.go(buffer.rd, 'ce');
					}
					let rq: Parsed[];
					if (buffer.rqt === 'M') {
						rq = _mhchemParser.go(buffer.rq, 'tex-math');
					} else if (buffer.rqt === 'T') {
						rq = [ { type_: 'text', p1: buffer.rq || ""} ];
					} else {
						rq = _mhchemParser.go(buffer.rq, 'ce');
					}
					ret = {
						type_: 'arrow',
						r: buffer.r,
						rd: rd,
						rq: rq
					};
				}
				for (const p in buffer) {
					if (p !== 'parenthesisLevel'  &&  p !== 'beginsWithBond') {
						//@ts-ignore
						delete buffer[p];
					}
				}
				return ret;
			},
			'oxidation-output': function (_buffer, m) {
				let ret = [ "{" ];
				_mhchemParser.concatArray(ret, _mhchemParser.go(m, 'oxidation'));
				ret.push("}");
				return ret;
			},
			'frac-output': function (_buffer, m) {
				return { type_: 'frac-ce', p1: _mhchemParser.go(m[0], 'ce'), p2: _mhchemParser.go(m[1], 'ce') };
			},
			'overset-output': function (_buffer, m) {
				return { type_: 'overset', p1: _mhchemParser.go(m[0], 'ce'), p2: _mhchemParser.go(m[1], 'ce') };
			},
			'underset-output': function (_buffer, m) {
				return { type_: 'underset', p1: _mhchemParser.go(m[0], 'ce'), p2: _mhchemParser.go(m[1], 'ce') };
			},
			'underbrace-output': function (_buffer, m) {
				return { type_: 'underbrace', p1: _mhchemParser.go(m[0], 'ce'), p2: _mhchemParser.go(m[1], 'ce') };
			},
			'color-output': function (_buffer, m) {
				return { type_: 'color', color1: m[0], color2: _mhchemParser.go(m[1], 'ce') };
			},
			'r=': function (buffer, m: ArrowName) { buffer.r = m; return undefined; },
			'rdt=': function (buffer, m) { buffer.rdt = m; return undefined; },
			'rd=': function (buffer, m) { buffer.rd = m; return undefined; },
			'rqt=': function (buffer, m) { buffer.rqt = m; return undefined; },
			'rq=': function (buffer, m) { buffer.rq = m; return undefined; },
			'operator': function (_buffer, m, p1) { return { type_: 'operator', kind_: (p1 || m) } as Parsed; }
		}
	},
	'a': {
		transitions: _mhchemCreateTransitions({
			'empty': {
				'*': { action_: [] } },
			'1/2$': {
				'0': { action_: '1/2' } },
			'else': {
				'0': { action_: [], nextState: '1', revisit: true } },
			'${(...)}$__$(...)$': {
				'*': { action_: 'tex-math tight', nextState: '1' } },
			',': {
				'*': { action_: { type_: 'insert', option: 'commaDecimal' } } },
			'else2': {
				'*': { action_: 'copy' } }
		}),
		actions: {}
	},
	'o': {
		transitions: _mhchemCreateTransitions({
			'empty': {
				'*': { action_: [] } },
			'1/2$': {
				'0': { action_: '1/2' } },
			'else': {
				'0': { action_: [], nextState: '1', revisit: true } },
			'letters': {
				'*': { action_: 'rm' } },
			'\\ca': {
				'*': { action_: { type_: 'insert', option: 'circa' } } },
			'\\pu{(...)}': {
				'*': { action_: [ { type_: 'write', option: "{" }, 'pu', { type_: 'write', option: "}" } ] } },
			'\\x{}{}|\\x{}|\\x': {
				'*': { action_: 'copy' } },
			'${(...)}$__$(...)$': {
				'*': { action_: 'tex-math' } },
			'{(...)}': {
				'*': { action_: [ { type_: 'write', option: "{" }, 'text', { type_: 'write', option: "}" } ] } },
			'else2': {
				'*': { action_: 'copy' } }
		}),
		actions: {}
	},
	'text': {
		transitions: _mhchemCreateTransitions({
			'empty': {
				'*': { action_: 'output' } },
			'{...}': {
				'*': { action_: 'text=' } },
			'${(...)}$__$(...)$': {
				'*': { action_: 'tex-math' } },
			'\\greek': {
				'*': { action_: [ 'output', 'rm' ] } },
			'\\pu{(...)}': {
				'*': { action_: [ 'output', { type_: 'write', option: "{" }, 'pu', { type_: 'write', option: "}" } ] } },
			'\\,|\\x{}{}|\\x{}|\\x': {
				'*': { action_: [ 'output', 'copy' ] } },
			'else': {
				'*': { action_: 'text=' } }
		}),
		actions: {
			'output': function (buffer): undefined | Parsed {
				if (buffer.text_) {
					let ret: Parsed = { type_: 'text', p1: buffer.text_ };
					//@ts-ignore
					for (const p in buffer) { delete buffer[p]; }
					return ret;
				}
				return undefined;
			}
		}
	},
	'pq': {
		transitions: _mhchemCreateTransitions({
			'empty': {
				'*': { action_: [] } },
			'state of aggregation $': {
				'*': { action_: 'state of aggregation' } },
			'i$': {
				'0': { action_: [], nextState: '!f', revisit: true } },
			'(KV letters),': {
				'0': { action_: 'rm', nextState: '0' } },
			'formula$': {
				'0': { action_: [], nextState: 'f', revisit: true } },
			'1/2$': {
				'0': { action_: '1/2' } },
			'else': {
				'0': { action_: [], nextState: '!f', revisit: true } },
			'${(...)}$__$(...)$': {
				'*': { action_: 'tex-math' } },
			'{(...)}': {
				'*': { action_: 'text' } },
			'a-z': {
				'f': { action_: 'tex-math' } },
			'letters': {
				'*': { action_: 'rm' } },
			'-9.,9': {
				'*': { action_: '9,9'  } },
			',': {
				'*': { action_: { type_: 'insert+p1', option: 'comma enumeration S' } } },
			'\\color{(...)}{(...)}': {
				'*': { action_: 'color-output' } },
			'\\color{(...)}': {
				'*': { action_: 'color0-output' } },
			'\\ce{(...)}': {
				'*': { action_: 'ce' } },
			'\\pu{(...)}': {
				'*': { action_: [ { type_: 'write', option: "{" }, 'pu', { type_: 'write', option: "}" } ] } },
			'\\,|\\x{}{}|\\x{}|\\x': {
				'*': { action_: 'copy' } },
			'else2': {
				'*': { action_: 'copy' } }
		}),
		actions: {
			'state of aggregation': function (_buffer, m) {
				return { type_: 'state of aggregation subscript', p1: _mhchemParser.go(m, 'o') };
			},
			'color-output': function (_buffer, m) {
				return { type_: 'color', color1: m[0], color2: _mhchemParser.go(m[1], 'pq') };
			}
		}
	},
	'bd': {
		transitions: _mhchemCreateTransitions({
			'empty': {
				'*': { action_: [] } },
			'x$': {
				'0': { action_: [], nextState: '!f', revisit: true } },
			'formula$': {
				'0': { action_: [], nextState: 'f', revisit: true } },
			'else': {
				'0': { action_: [], nextState: '!f', revisit: true } },
			'-9.,9 no missing 0': {
				'*': { action_: '9,9' } },
			'.': {
				'*': { action_: { type_: 'insert', option: 'electron dot' } } },
			'a-z': {
				'f': { action_: 'tex-math' } },
			'x': {
				'*': { action_: { type_: 'insert', option: 'KV x' } } },
			'letters': {
				'*': { action_: 'rm' } },
			'\'': {
				'*': { action_: { type_: 'insert', option: 'prime' } } },
			'${(...)}$__$(...)$': {
				'*': { action_: 'tex-math' } },
			'{(...)}': {
				'*': { action_: 'text' } },
			'\\color{(...)}{(...)}': {
				'*': { action_: 'color-output' } },
			'\\color{(...)}': {
				'*': { action_: 'color0-output' } },
			'\\ce{(...)}': {
				'*': { action_: 'ce' } },
			'\\pu{(...)}': {
				'*': { action_: [ { type_: 'write', option: "{" }, 'pu', { type_: 'write', option: "}" } ] } },
			'\\,|\\x{}{}|\\x{}|\\x': {
				'*': { action_: 'copy' } },
			'else2': {
				'*': { action_: 'copy' } }
		}),
		actions: {
			'color-output': function (_buffer, m) {
				return { type_: 'color', color1: m[0], color2: _mhchemParser.go(m[1], 'bd') };
			}
		}
	},
	'oxidation': {
		transitions: _mhchemCreateTransitions({
			'empty': {
				'*': { action_: 'roman-numeral' } },
			'pm-operator': {
				'*': { action_: { type_: 'o=+p1', option: "\\pm" } } },
			'else': {
				'*': { action_: 'o=' } }
		}),
		actions: {
			'roman-numeral': function (buffer) { return { type_: 'roman numeral', p1: buffer.o || "" }; }
		}
	},
	'tex-math': {
		transitions: _mhchemCreateTransitions({
			'empty': {
				'*': { action_: 'output' } },
			'\\ce{(...)}': {
				'*': { action_: [ 'output', 'ce' ] } },
			'\\pu{(...)}': {
				'*': { action_: [ 'output', { type_: 'write', option: "{" }, 'pu', { type_: 'write', option: "}" } ] } },
			'{...}|\\,|\\x{}{}|\\x{}|\\x': {
				'*': { action_: 'o=' } },
			'else': {
				'*': { action_: 'o=' } }
		}),
		actions: {
			'output': function (buffer): undefined | Parsed {
				if (buffer.o) {
					let ret: Parsed = { type_: 'tex-math', p1: buffer.o };
					//@ts-ignore
					for (const p in buffer) { delete buffer[p]; }
					return ret;
				}
				return undefined;
			}
		}
	},
	'tex-math tight': {
		transitions: _mhchemCreateTransitions({
			'empty': {
				'*': { action_: 'output' } },
			'\\ce{(...)}': {
				'*': { action_: [ 'output', 'ce' ] } },
			'\\pu{(...)}': {
				'*': { action_: [ 'output', { type_: 'write', option: "{" }, 'pu', { type_: 'write', option: "}" } ] } },
			'{...}|\\,|\\x{}{}|\\x{}|\\x': {
				'*': { action_: 'o=' } },
			'-|+': {
				'*': { action_: 'tight operator' } },
			'else': {
				'*': { action_: 'o=' } }
		}),
		actions: {
			'tight operator': function (buffer, m) { buffer.o = (buffer.o || "") + "{" + m + "}"; return undefined; },
			'output': function (buffer): undefined | Parsed {
				if (buffer.o) {
					let ret: Parsed = { type_: 'tex-math', p1: buffer.o };
					//@ts-ignore
					for (const p in buffer) { delete buffer[p]; }
					return ret;
				}
				return undefined;
			}
		}
	},
	'9,9': {
		transitions: _mhchemCreateTransitions({
			'empty': {
				'*': { action_: [] } },
			',': {
				'*': { action_: 'comma' } },
			'else': {
				'*': { action_: 'copy' } }
		}),
		actions: {
			'comma': function () { return { type_: 'commaDecimal' }; }
		}
	},
	//#endregion
	//
	// \pu state machines
	//
	//#region pu
	'pu': {
		transitions: _mhchemCreateTransitions({
			'empty': {
				'*': { action_: 'output' } },
			'space$': {
				'*': { action_: [ 'output', 'space' ] } },
			'{[(|)]}': {
				'0|a': { action_: 'copy' } },
			'(-)(9)^(-9)': {
				'0': { action_: 'number^', nextState: 'a' } },
			'(-)(9.,9)(e)(99)': {
				'0': { action_: 'enumber', nextState: 'a' } },
			'space': {
				'0|a': { action_: [] } },
			'pm-operator': {
				'0|a': { action_: { type_: 'operator', option: '\\pm' }, nextState: '0' } },
			'operator': {
				'0|a': { action_: 'copy', nextState: '0' } },
			'//': {
				'd': { action_: 'o=', nextState: '/' } },
			'/': {
				'd': { action_: 'o=', nextState: '/' } },
			'{...}|else': {
				'0|d': { action_: 'd=', nextState: 'd' },
				'a': { action_: [ 'space', 'd=' ], nextState: 'd' },
				'/|q': { action_: 'q=', nextState: 'q' } }
		}),
		actions: {
			'enumber': function (_buffer, m) {
				let ret: Parsed[] = [];
				if (m[0] === "+-"  ||  m[0] === "+/-") {
					ret.push("\\pm ");
				} else if (m[0]) {
					ret.push(m[0]);
				}
				if (m[1]) {  // 1.2
					_mhchemParser.concatArray(ret, _mhchemParser.go(m[1], 'pu-9,9'));
					if (m[2]) {
						if (m[2].match(/[,.]/)) {  // 1.23456(0.01111)
							_mhchemParser.concatArray(ret, _mhchemParser.go(m[2], 'pu-9,9'));
						} else {  // 1.23456(1111)  - without spacings
							ret.push(m[2]);
						}
					}
					if (m[3] || m[4]) {  // 1.2e7  1.2x10^7
						if (m[3] === "e"  ||  m[4] === "*") {
							ret.push({ type_: 'cdot' });
						} else {
							ret.push({ type_: 'times' });
						}
					}
				}
				if (m[5]) {  // 10^7
					ret.push("10^{" + m[5] + "}");
				}
				return ret;
			},
			'number^': function (_buffer, m) {
				let ret: Parsed[] = [];
				if (m[0] === "+-"  ||  m[0] === "+/-") {
					ret.push("\\pm ");
				} else if (m[0]) {
					ret.push(m[0]);
				}
				_mhchemParser.concatArray(ret, _mhchemParser.go(m[1], 'pu-9,9'));
				ret.push("^{" + m[2] + "}");
				return ret;
			},
			'operator': function (_buffer, m, p1) { return { type_: 'operator', kind_: (p1 || m) } as Parsed; },
			'space': function () { return { type_: 'pu-space-1' }; },
			'output': function (buffer) {
				let ret: Parsed | Parsed[];
				const md = _mhchemParser.patterns.match_('{(...)}', buffer.d || "");
				if (md  &&  md.remainder === '') { buffer.d = md.match_ as string; }
				const mq = _mhchemParser.patterns.match_('{(...)}', buffer.q || "");
				if (mq  &&  mq.remainder === '') { buffer.q = mq.match_ as string; }
				if (buffer.d) {
					buffer.d = buffer.d.replace(/\u00B0C|\^oC|\^{o}C/g, "{}^{\\circ}C");
					buffer.d = buffer.d.replace(/\u00B0F|\^oF|\^{o}F/g, "{}^{\\circ}F");
				}
				if (buffer.q) {  // fraction
					buffer.q = buffer.q.replace(/\u00B0C|\^oC|\^{o}C/g, "{}^{\\circ}C");
					buffer.q = buffer.q.replace(/\u00B0F|\^oF|\^{o}F/g, "{}^{\\circ}F");
					const b5 = {
						d: _mhchemParser.go(buffer.d, 'pu'),
						q: _mhchemParser.go(buffer.q, 'pu')
					};
					if (buffer.o === '//') {
						ret = { type_: 'pu-frac', p1: b5.d, p2: b5.q };
					} else {
						ret = b5.d;
						if (b5.d.length > 1  ||  b5.q.length > 1) {
							ret.push({ type_: ' / ' });
						} else {
							ret.push({ type_: '/' });
						}
						_mhchemParser.concatArray(ret, b5.q);
					}
				} else {  // no fraction
					ret = _mhchemParser.go(buffer.d, 'pu-2');
				}
				//@ts-ignore
				for (const p in buffer) { delete buffer[p]; }
				return ret;
			}
		}
	},
	'pu-2': {
		transitions: _mhchemCreateTransitions({
			'empty': {
				'*': { action_: 'output' } },
			'*': {
				'*': { action_: [ 'output', 'cdot' ], nextState: '0' } },
			'\\x': {
				'*': { action_: 'rm=' } },
			'space': {
				'*': { action_: [ 'output', 'space' ], nextState: '0' } },
			'^{(...)}|^(-1)': {
				'1': { action_: '^(-1)' } },
			'-9.,9': {
				'0': { action_: 'rm=', nextState: '0' },
				'1': { action_: '^(-1)', nextState: '0' } },
			'{...}|else': {
				'*': { action_: 'rm=', nextState: '1' } }
		}),
		actions: {
			'cdot': function () { return { type_: 'tight cdot' }; },
			'^(-1)': function (buffer, m) { buffer.rm += "^{" + m + "}"; return undefined; },
			'space': function () { return { type_: 'pu-space-2' }; },
			'output': function (buffer) {
				let ret: Parsed | Parsed[] = [];
				if (buffer.rm) {
					const mrm = _mhchemParser.patterns.match_('{(...)}', buffer.rm || "") as MatchResult<string>;
					if (mrm  &&  mrm.remainder === '') {
						ret = _mhchemParser.go(mrm.match_, 'pu');
					} else {
						ret = { type_: 'rm', p1: buffer.rm };
					}
				}
				//@ts-ignore
				for (const p in buffer) { delete buffer[p]; }
				return ret;
			}
		}
	},
	'pu-9,9': {
		transitions: _mhchemCreateTransitions({
			'empty': {
				'0': { action_: 'output-0' },
				'o': { action_: 'output-o' } },
			',': {
				'0': { action_: [ 'output-0', 'comma' ], nextState: 'o' } },
			'.': {
				'0': { action_: [ 'output-0', 'copy' ], nextState: 'o' } },
			'else': {
				'*': { action_: 'text=' } }
		}),
		actions: {
			'comma': function () { return { type_: 'commaDecimal' }; },
			'output-0': function (buffer) {
				let ret: Parsed[] = [];
				buffer.text_ = buffer.text_ || "";
				if (buffer.text_.length > 4) {
					let a = buffer.text_.length % 3;
					if (a === 0) { a = 3; }
					for (let i=buffer.text_.length-3; i>0; i-=3) {
						ret.push(buffer.text_.substr(i, 3));
						ret.push({ type_: '1000 separator' });
					}
					ret.push(buffer.text_.substr(0, a));
					ret.reverse();
				} else {
					ret.push(buffer.text_);
				}
				//@ts-ignore
				for (const p in buffer) { delete buffer[p]; }
				return ret;
			},
			'output-o': function (buffer) {
				let ret: Parsed[] = [];
				buffer.text_ = buffer.text_ || "";
				if (buffer.text_.length > 4) {
					const a = buffer.text_.length - 3;
					let i: number;
					for (i=0; i<a; i+=3) {
						ret.push(buffer.text_.substr(i, 3));
						ret.push({ type_: '1000 separator' });
					}
					ret.push(buffer.text_.substr(i));
				} else {
					ret.push(buffer.text_);
				}
				//@ts-ignore
				for (const p in buffer) { delete buffer[p]; }
				return ret;
			}
		}
	}
	//#endregion
}
};

//
// mhchemTexify: Take MhchemParser output and convert it to TeX
//
const _mhchemTexify: MhchemTexify = {
	go: function (input, addOuterBraces) {  // (recursive, max 4 levels)
		if (!input) { return ""; }
		let res = "";
		let cee = false;
		for (let i=0; i < input.length; i++) {
			const inputi = input[i];
			if (typeof inputi === "string") {
				res += inputi;
			} else {
				res += _mhchemTexify._go2(inputi);
				if (inputi.type_ === '1st-level escape') { cee = true; }
			}
		}
		if (addOuterBraces && !cee && res) {
			res = "{" + res + "}";
		}
		return res;
	},
	_goInner: function (input) {
		return _mhchemTexify.go(input, false);
	},
	_go2: function (buf) {
		let res: string;
		switch (buf.type_) {
			case 'chemfive':
				res = "";
				const b5 = {
					a: _mhchemTexify._goInner(buf.a),
					b: _mhchemTexify._goInner(buf.b),
					p: _mhchemTexify._goInner(buf.p),
					o: _mhchemTexify._goInner(buf.o),
					q: _mhchemTexify._goInner(buf.q),
					d: _mhchemTexify._goInner(buf.d)
				};
				//
				// a
				//
				if (b5.a) {
					if (b5.a.match(/^[+\-]/)) { b5.a = "{" + b5.a + "}"; }
					res += b5.a + "\\,";
				}
				//
				// b and p
				//
				if (b5.b || b5.p) {
					res += "{\\vphantom{A}}";
					res += "^{\\hphantom{" + (b5.b || "") + "}}_{\\hphantom{" + (b5.p || "") + "}}";
					res += "\\mkern-1.5mu";
					res += "{\\vphantom{A}}";
					res += "^{\\smash[t]{\\vphantom{2}}\\llap{" + (b5.b || "") + "}}";
					res += "_{\\vphantom{2}\\llap{\\smash[t]{" + (b5.p || "") + "}}}";
				}
				//
				// o
				//
				if (b5.o) {
					if (b5.o.match(/^[+\-]/)) { b5.o = "{" + b5.o + "}"; }
					res += b5.o;
				}
				//
				// q and d
				//
				if (buf.dType === 'kv') {
					if (b5.d || b5.q) {
						res += "{\\vphantom{A}}";
					}
					if (b5.d) {
						res += "^{" + b5.d + "}";
					}
					if (b5.q) {
						res += "_{\\smash[t]{" + b5.q + "}}";
					}
				} else if (buf.dType === 'oxidation') {
					if (b5.d) {
						res += "{\\vphantom{A}}";
						res += "^{" + b5.d + "}";
					}
					if (b5.q) {
						res += "{\\vphantom{A}}";
						res += "_{\\smash[t]{" + b5.q + "}}";
					}
				} else {
					if (b5.q) {
						res += "{\\vphantom{A}}";
						res += "_{\\smash[t]{" + b5.q + "}}";
					}
					if (b5.d) {
						res += "{\\vphantom{A}}";
						res += "^{" + b5.d + "}";
					}
				}
				break;
			case 'rm':
				res = "\\mathrm{" + buf.p1 + "}";
				break;
			case 'text':
				if (buf.p1.match(/[\^_]/)) {
					buf.p1 = buf.p1.replace(" ", "~").replace("-", "\\text{-}");
					res = "\\mathrm{" + buf.p1 + "}";
				} else {
					res = "\\text{" + buf.p1 + "}";
				}
				break;
			case 'roman numeral':
				res = "\\mathrm{" + buf.p1 + "}";
				break;
			case 'state of aggregation':
				res = "\\mskip2mu " + _mhchemTexify._goInner(buf.p1);
				break;
			case 'state of aggregation subscript':
				res = "\\mskip1mu " + _mhchemTexify._goInner(buf.p1);
				break;
			case 'bond':
				res = _mhchemTexify._getBond(buf.kind_);
				if (!res) {
					throw ["MhchemErrorBond", "mhchem Error. Unknown bond type (" + buf.kind_ + ")"];
				}
				break;
			case 'frac':
				const c = "\\frac{" + buf.p1 + "}{" + buf.p2 + "}";
				res = "\\mathchoice{\\textstyle" + c + "}{" + c + "}{" + c + "}{" + c + "}";
				break;
			case 'pu-frac':
				const d = "\\frac{" + _mhchemTexify._goInner(buf.p1) + "}{" + _mhchemTexify._goInner(buf.p2) + "}";
				res = "\\mathchoice{\\textstyle" + d + "}{" + d + "}{" + d + "}{" + d + "}";
				break;
			case 'tex-math':
				res = buf.p1 + " ";
				break;
			case 'frac-ce':
				res = "\\frac{" + _mhchemTexify._goInner(buf.p1) + "}{" + _mhchemTexify._goInner(buf.p2) + "}";
				break;
			case 'overset':
				res = "\\overset{" + _mhchemTexify._goInner(buf.p1) + "}{" + _mhchemTexify._goInner(buf.p2) + "}";
				break;
			case 'underset':
				res = "\\underset{" + _mhchemTexify._goInner(buf.p1) + "}{" + _mhchemTexify._goInner(buf.p2) + "}";
				break;
			case 'underbrace':
				res =  "\\underbrace{" + _mhchemTexify._goInner(buf.p1) + "}_{" + _mhchemTexify._goInner(buf.p2) + "}";
				break;
			case 'color':
				res = "{\\color{" + buf.color1 + "}{" + _mhchemTexify._goInner(buf.color2) + "}}";
				break;
			case 'color0':
				res = "\\color{" + buf.color + "}";
				break;
			case 'arrow':
				const b6 = {
					rd: _mhchemTexify._goInner(buf.rd),
					rq: _mhchemTexify._goInner(buf.rq)
				} as const;
				let arrow = _mhchemTexify._getArrow(buf.r);
				if (b6.rd || b6.rq) {
					if (buf.r === "<=>"  ||  buf.r === "<=>>"  ||  buf.r === "<<=>"  ||  buf.r === "<-->") {
						// arrows that cannot stretch correctly yet, https://github.com/mathjax/MathJax/issues/1491
						arrow = "\\long" + arrow;
						if (b6.rd) { arrow = "\\overset{" + b6.rd + "}{" + arrow + "}"; }
						if (b6.rq) {
							if (buf.r === "<-->") {
								arrow = "\\underset{\\lower2mu{" + b6.rq + "}}{" + arrow + "}";
							} else {
								arrow = "\\underset{\\lower6mu{" + b6.rq + "}}{" + arrow + "}";  // align with ->[][under]
							}
						}
						arrow = " {}\\mathrel{" + arrow + "}{} ";
					} else {
						if (b6.rq) { arrow += "[{" + b6.rq + "}]"; }
						arrow += "{" + b6.rd + "}";
						arrow = " {}\\mathrel{\\x" + arrow + "}{} ";
					}
				} else {
					arrow = " {}\\mathrel{\\long" + arrow + "}{} ";
				}
				res = arrow;
				break;
			case 'operator':
				res = _mhchemTexify._getOperator(buf.kind_);
				break;
			case '1st-level escape':
				res = buf.p1 + " ";  // &, \\\\, \\hline
				break;
			case 'space':
				res = " ";
				break;
			case 'tinySkip':
				res = '\\mkern2mu';
				break;
			case 'entitySkip':
				res = "~";
				break;
			case 'pu-space-1':
				res = "~";
				break;
			case 'pu-space-2':
				res = "\\mkern3mu ";
				break;
			case '1000 separator':
				res = "\\mkern2mu ";
				break;
			case 'commaDecimal':
				res = "{,}";
				break;
				case 'comma enumeration L':
				res = "{" + buf.p1 + "}\\mkern6mu ";
				break;
			case 'comma enumeration M':
				res = "{" + buf.p1 + "}\\mkern3mu ";
				break;
			case 'comma enumeration S':
				res = "{" + buf.p1 + "}\\mkern1mu ";
				break;
			case 'hyphen':
				res = "\\text{-}";
				break;
			case 'addition compound':
				res = "\\,{\\cdot}\\,";
				break;
			case 'electron dot':
				res = "\\mkern1mu \\bullet\\mkern1mu ";
				break;
			case 'KV x':
				res = "{\\times}";
				break;
			case 'prime':
				res = "\\prime ";
				break;
			case 'cdot':
				res = "\\cdot ";
				break;
			case 'tight cdot':
				res = "\\mkern1mu{\\cdot}\\mkern1mu ";
				break;
			case 'times':
				res = "\\times ";
				break;
			case 'circa':
				res = "{\\sim}";
				break;
			case '^':
				res = "uparrow";
				break;
			case 'v':
				res = "downarrow";
				break;
			case 'ellipsis':
				res = "\\ldots ";
				break;
			case '/':
				res = "/";
				break;
			case ' / ':
				res = "\\,/\\,";
				break;
			default:
				assertNever(buf);
				throw ["MhchemBugT", "mhchem bug T. Please report."];  // Missing mhchemTexify rule or unknown MhchemParser output
		}
		return res;
	},
	_getArrow: function (a) {
		switch (a) {
			case "->": return "rightarrow";
			case "\u2192": return "rightarrow";
			case "\u27F6": return "rightarrow";
			case "<-": return "leftarrow";
			case "<->": return "leftrightarrow";
			case "<-->": return "leftrightarrows";
			case "<=>": return "rightleftharpoons";
			case "\u21CC": return "rightleftharpoons";
			case "<=>>": return "Rightleftharpoons";
			case "<<=>": return "Leftrightharpoons";
			default:
				assertNever(a);
				throw ["MhchemBugT", "mhchem bug T. Please report."];
		}
	},
	_getBond: function (a) {
		switch (a) {
			case "-": return "{-}";
			case "1": return "{-}";
			case "=": return "{=}";
			case "2": return "{=}";
			case "#": return "{\\equiv}";
			case "3": return "{\\equiv}";
			case "~": return "{\\tripledash}";
			case "~-": return "{\\rlap{\\lower.1em{-}}\\raise.1em{\\tripledash}}";
			case "~=": return "{\\rlap{\\lower.2em{-}}\\rlap{\\raise.2em{\\tripledash}}-}";
			case "~--": return "{\\rlap{\\lower.2em{-}}\\rlap{\\raise.2em{\\tripledash}}-}";
			case "-~-": return "{\\rlap{\\lower.2em{-}}\\rlap{\\raise.2em{-}}\\tripledash}";
			case "...": return "{{\\cdot}{\\cdot}{\\cdot}}";
			case "....": return "{{\\cdot}{\\cdot}{\\cdot}{\\cdot}}";
			case "->": return "{\\rightarrow}";
			case "<-": return "{\\leftarrow}";
			case "<": return "{<}";
			case ">": return "{>}";
			default:
				assertNever(a);
				throw ["MhchemBugT", "mhchem bug T. Please report."];
		}
	},
	_getOperator: function (a) {
		switch (a) {
			case "+": return " {}+{} ";
			case "-": return " {}-{} ";
			case "=": return " {}={} ";
			case "<": return " {}<{} ";
			case ">": return " {}>{} ";
			case "<<": return " {}\\ll{} ";
			case ">>": return " {}\\gg{} ";
			case "\\pm": return " {}\\pm{} ";
			case "\\approx": return " {}\\approx{} ";
			case "$\\approx$": return " {}\\approx{} ";
			case "v": return " \\downarrow{} ";
			case "(v)": return " \\downarrow{} ";
			case "^": return " \\uparrow{} ";
			case "(^)": return " \\uparrow{} ";
			default:
				assertNever(a);
				throw ["MhchemBugT", "mhchem bug T. Please report."];
		}
	}
};

//
// Helpers for code anaylsis
// Will show type error at calling position
//
//@ts-ignore
function assertNever(a: number) {}
