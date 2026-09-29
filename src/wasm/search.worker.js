

let cdscoIndex = [];
let janAushadhiIndex = [];

let cdscoAvgDl = 0;
let jaAvgDl = 0;

const K1 = 1.2;
const B = 0.75;

function getPhoneticCode(word) {
  if (!word) return '';
  let str = word.toUpperCase().replace(/[^A-Z]/g, '');
  if (str.length === 0) return '';
  
  let code = '';
  let i = 0;

  while (code.length < 4 && i < str.length) {
    const c = str[i];
    const next = str[i + 1] || '';
    const prev = str[i - 1] || '';

    if (i === 0 && c === 'A' && next === 'E') { code += 'X'; i += 2; continue; }
    if (c === 'A' || c === 'E' || c === 'I' || c === 'O' || c === 'U' || c === 'Y') {
      if (i === 0) code += c;
      i++;
      continue;
    }

    switch (c) {
      case 'B':
        code += 'B';
        if (next === 'B') i++;
        break;
      case 'C':
        if (['E', 'I', 'Y'].includes(next)) {
          code += 'S';
        } else if (next === 'H') {
          code += 'X';
          i++;
        } else {
          code += 'K';
        }
        if (next === 'C') i++;
        break;
      case 'D':
        if (next === 'G' && ['E', 'I', 'Y'].includes(str[i + 2])) {
          code += 'J';
          i += 2;
        } else {
          code += 'T';
        }
        break;
      case 'F':
        code += 'F';
        if (next === 'F') i++;
        break;
      case 'G':
        if (['E', 'I', 'Y'].includes(next)) {
          code += 'J';
        } else if (next === 'H') {
          code += 'F';
          i++;
        } else {
          code += 'K';
        }
        if (next === 'G') i++;
        break;
      case 'H':
        if (i === 0 || ['A','E','I','O','U'].includes(prev)) {
          code += 'H';
        }
        break;
      case 'J':
        code += 'J';
        break;
      case 'K':
        code += 'K';
        if (next === 'K') i++;
        break;
      case 'L':
        code += 'L';
        if (next === 'L') i++;
        break;
      case 'M':
        code += 'M';
        if (next === 'M') i++;
        break;
      case 'N':
        code += 'N';
        if (next === 'N') i++;
        break;
      case 'P':
        if (next === 'H') {
          code += 'F';
          i++;
        } else {
          code += 'P';
        }
        if (next === 'P') i++;
        break;
      case 'Q':
        code += 'K';
        break;
      case 'R':
        code += 'R';
        if (next === 'R') i++;
        break;
      case 'S':
        if (next === 'H') {
          code += 'X';
          i++;
        } else if (next === 'C' && ['E', 'I', 'Y'].includes(str[i + 2])) {
          code += 'S';
          i += 2;
        } else {
          code += 'S';
        }
        if (next === 'S') i++;
        break;
      case 'T':
        if (next === 'H') {
          code += '0';
          i++;
        } else if (next === 'I' && ['A', 'O'].includes(str[i + 2])) {
          code += 'X';
          i += 2;
        } else {
          code += 'T';
        }
        if (next === 'T') i++;
        break;
      case 'V':
        code += 'F';
        break;
      case 'W':
      case 'Y':
        if (['A','E','I','O','U'].includes(next)) {
          code += c;
        }
        break;
      case 'X':
        code += 'KS';
        break;
      case 'Z':
        code += 'S';
        break;
    }
    i++;
  }
  return code;
}

function levenshteinDistance(s1, s2) {
  const len1 = s1.length;
  const len2 = s2.length;
  const matrix = Array.from({ length: len1 + 1 }, () => new Array(len2 + 1).fill(0));

  for (let i = 0; i <= len1; i++) matrix[i][0] = i;
  for (let j = 0; j <= len2; j++) matrix[0][j] = j;

  for (let i = 1; i <= len1; i++) {
    for (let j = 1; j <= len2; j++) {
      const cost = s1[i - 1] === s2[j - 1] ? 0 : 1;
      matrix[i][j] = Math.min(
        matrix[i - 1][j] + 1,
        matrix[i][j - 1] + 1,
        matrix[i - 1][j - 1] + cost
      );
    }
  }
  return matrix[len1][len2];
}

function tokenize(text) {
  return (text || '').toLowerCase()
    .replace(/[^a-z0-9\s]/g, '')
    .split(/\s+/)
    .filter(t => t.length > 1);
}

function buildIndex(rows, textKey) {
  let totalLen = 0;
  const indexed = rows.map((row, idx) => {
    const text = row[textKey] || '';
    const tokens = tokenize(text);
    totalLen += tokens.length;

    const phonetics = tokens.map(t => getPhoneticCode(t));

    return {
      id: idx,
      raw: row,
      text: text.toLowerCase(),
      tokens,
      phonetics,
      length: tokens.length
    };
  });

  const avgDl = rows.length ? totalLen / rows.length : 0;
  return { indexed, avgDl };
}

function computeIDF(term, collection) {
  const N = collection.length;
  let df = 0;
  for (const doc of collection) {
    if (doc.tokens.includes(term)) {
      df++;
    }
  }
  return Math.log(((N - df + 0.5) / (df + 0.5)) + 1);
}

function searchCatalog(query, indexedColl, avgDl) {
  if (!query) return [];
  const queryTokens = tokenize(query);
  if (queryTokens.length === 0) return [];

  const queryPhonetics = queryTokens.map(t => getPhoneticCode(t));
  const results = [];

  const idfs = queryTokens.map(term => computeIDF(term, indexedColl));

  for (const doc of indexedColl) {
    let bm25Score = 0;
    let phoneticScore = 0;

    queryTokens.forEach((qToken, qIdx) => {
      const idf = idfs[qIdx];
      const tf = doc.tokens.filter(t => t === qToken).length;
      if (tf > 0) {
        const numerator = tf * (K1 + 1);
        const denominator = tf + K1 * (1 - B + B * (doc.length / (avgDl || 1)));
        bm25Score += idf * (numerator / denominator);
      }
    });

    queryPhonetics.forEach((qPhonetic) => {
      if (qPhonetic) {
        const matchCount = doc.phonetics.filter(dp => dp === qPhonetic).length;
        if (matchCount > 0) {
          phoneticScore += matchCount * 1.5;
        }
      }
    });

    const textWords = doc.text.split(' ');
    let bestEditDistance = 999;
    queryTokens.forEach(qToken => {
      textWords.forEach(dWord => {
        if (Math.abs(dWord.length - qToken.length) <= 2) {
          const dist = levenshteinDistance(qToken, dWord);
          if (dist < bestEditDistance) {
            bestEditDistance = dist;
          }
        }
      });
    });

    let editScore = 0;
    if (bestEditDistance === 0) editScore = 2.0;
    else if (bestEditDistance === 1) editScore = 1.0;
    else if (bestEditDistance === 2) editScore = 0.4;

    const totalScore = bm25Score + phoneticScore + editScore;

    if (totalScore > 0.15) {
      results.push({
        row: doc.raw,
        score: totalScore,
        exactMatch: bm25Score > 0
      });
    }
  }

  return results.sort((a, b) => b.score - a.score).slice(0, 10);
}

self.onmessage = function (e) {
  const { type, data } = e.data;

  if (type === 'init') {
    const { cdscoText, jaText } = data;
    try {
      const parse = (text) => {
        const lines = text.split(/\r?\n/).filter(l => l.trim());
        if (!lines.length) return [];
        const headers = lines[0].split(',').map(h => h.trim().replace(/"/g, ''));
        return lines.slice(1).map(line => {
          const vals = [];
          let cur = '';
          let inQ = false;
          for (let i = 0; i < line.length; i++) {
            const ch = line[i];
            if (ch === '"') inQ = !inQ;
            else if (ch === ',' && !inQ) {
              vals.push(cur);
              cur = '';
            } else {
              cur += ch;
            }
          }
          vals.push(cur);
          const row = {};
          headers.forEach((h, idx) => {
            row[h] = (vals[idx] || '').trim().replace(/"/g, '');
          });
          return row;
        });
      };

      const cdscoRows = parse(cdscoText);
      const jaRows = parse(jaText);

      const cdscoData = buildIndex(cdscoRows, 'Drug Name');
      cdscoIndex = cdscoData.indexed;
      cdscoAvgDl = cdscoData.avgDl;

      const jaData = buildIndex(jaRows, 'Generic Name');
      janAushadhiIndex = jaData.indexed;
      jaAvgDl = jaData.avgDl;

      self.postMessage({ type: 'initialized', success: true });
    } catch (err) {
      self.postMessage({ type: 'initialized', success: false, error: err.message });
    }
  }

  else if (type === 'search') {
    const { query } = data;
    try {
      const cdscoResults = searchCatalog(query, cdscoIndex, cdscoAvgDl);
      const jaResults = searchCatalog(query, janAushadhiIndex, jaAvgDl);

      self.postMessage({
        type: 'results',
        query,
        cdsco: cdscoResults,
        ja: jaResults
      });
    } catch (err) {
      self.postMessage({ type: 'error', error: err.message });
    }
  }
};
