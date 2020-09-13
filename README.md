# mhchem Parser

mhchem an input syntax for typesetting chemical equations and physical units.

This is the parser to convert mhchem syntax to LaTeX syntax, for downstream inclusion in [MathJax](https://mathjax.org), [KaTeX](https://katex.org) and similar projects.


## Usage

Users of MathJax and KaTex can write

    \ce{CO2 + C -> 2 CO}
    \pu{123 kJ*mol-1}

For a hundred more features and how to configure MathJax or KaTeX, see
[the manual](https://mhchem.github.io/MathJax-mhchem/).


## Usage for Downstream Software

For "translating" the `\ce` syntax, make a call like

    mhchemParser.toTex("CO2 + C -> 2 CO", "ce");

This will return

    "{\mathrm{CO}{\vphantom{X}}_{\smash[t]{2}} {}+{} \mathrm{C} {}\mathrel{\longrightarrow}{} 2\,\mathrm{CO}}"

For the `\pu` command, call

    mhchemParser.toTex("123 kJ*mol-1", "pu");

You could also insert a TeX string. All instances of `\ce` and `\pu` will be replaced in the returned value. This might make integration easier, because the mhchem parser does not need to be called from the TeX parser.

    mhchemParser.toTex("m_{\\ce{H2O}}", "tex");


## Changes compared to MathJax v2.6.0 "legacy: true"

- Complete rewrite of syntax parser
- Staggered layout for charges (IUPAC style)
- Improved spacing and space handling: 1/2 X^{2-} v, $n-1$ H^3HO(g), ^{22,98}_{11}Na, ...
- Decimal amounts: 0.5 H2O, 0,5 H2O
- Advanced charge/bond/hyphen distinction: OH-(aq), \mu-Cl, -H- ...
- Decimal and negative superscripts/subscripts: ^0_-1n-, ^{22.98}_{11}Na
- Superscript electrons: OCO^{.-}
- IUPAC fraction style: (1/2)H2O
- Auto-italic variables: n H2O, nH2O, NO_x, but pH
- Improved scanning: Fe^n+, X_\alpha, NO_$x$, $\alpha$$a$, ...
- Some unicode input, e.g. arrows
- {text} text escape
- \bond{3}
- Arrow arguments now parsed as \ce: A ->[H2O] B, A ->[$x$] B
- <--> arrow
- More opeators: A + B = C - D, \pm
- Recursion works (\ce inside \ce)
- Removed hardly used synonyms \cf, \cee and command \hyphen
- Excited state: X^*
- Ellipsis vs bond: A...A, B...B, ...
- Punctuation: , ;
- Orbitals: sp^2, s^{0.5}p^3-N
- Kröger-Vink notation
- Better-looking Fast-HTML rendering: \ce{A + _{a}X}
- Many other things
- Differing side-effects for non-standard input
