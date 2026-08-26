import test from 'node:test';
import assert from 'node:assert/strict';
import { buildIdentityCandidates, matchConfidence, normalizeTitle, rescueProviderConfig } from '../src/metadata-rescue.mjs';

test('cleans a movie release into a useful TMDB query', () => {
  const id = buildIdentityCandidates({
    relative_path: 'Film/Dune.Part.Two.2024.2160p.UHD.BluRay.HEVC.TrueHD.Atmos.mkv',
    filename: 'Dune.Part.Two.2024.2160p.UHD.BluRay.HEVC.TrueHD.Atmos.mkv'
  });
  assert.equal(id.kind, 'movie');
  assert.equal(id.year, 2024);
  assert.equal(normalizeTitle(id.query), 'dune part two');
});

test('Marvel library root is not treated as a movie title candidate', () => {
  const filename = 'Avengers.Endgame.2019.2160p.4K.BluRay.x265.10bit.AAC5.1-[YTS.MX] (1).mkv';
  const id = buildIdentityCandidates({ relative_path: `Marvel/${filename}`, filename });
  assert.equal(id.kind, 'movie');
  assert.equal(id.year, 2019);
  assert.equal(normalizeTitle(id.query), 'avengers endgame');
  assert.equal(id.queries.some(q => normalizeTitle(q) === 'marvel'), false);
});

test('Metadata Rescue strips GalaxyRG prefix from a Marvel movie', () => {
  const filename = 'GalaxyRG - Madame.Web.2024.1080p.WEBRip.1400MB.DD5.1.x264-GalaxyRG.mkv';
  const id = buildIdentityCandidates({ relative_path: `Marvel/${filename}`, filename });
  assert.equal(id.kind, 'movie');
  assert.equal(id.year, 2024);
  assert.equal(normalizeTitle(id.query), 'madame web');
});

test('unrelated same-year titles do not get enough confidence', () => {
  const score = matchConfidence('Ant Man', 'Marvel Super Hero Adventures - Combattimento glaciale!', 2015, 2015);
  assert.equal(score, 0);
});

test('recognizes One Piece S21 E1047 as TV/anime and keeps series title', () => {
  const id = buildIdentityCandidates({
    relative_path: 'OP2/One Piece/S21/One.Piece.E1047.1080p.mp4',
    filename: 'One.Piece.E1047.1080p.mp4'
  });
  assert.equal(id.kind, 'tv');
  assert.equal(id.season, 21);
  assert.equal(id.episode, 1047);
  assert.equal(normalizeTitle(id.query), 'one piece');
  assert.equal(id.animeLikely, true);
});

test('OP2 root alone resolves to One Piece for season metadata', () => {
  const id = buildIdentityCandidates({
    relative_path: 'OP2/S23/One.Piece.S23E01.1080p.WEB-DL.mkv',
    filename: 'One.Piece.S23E01.1080p.WEB-DL.mkv'
  });
  assert.equal(id.kind, 'tv');
  assert.equal(id.season, 23);
  assert.equal(id.episode, 1);
  assert.equal(normalizeTitle(id.query), 'one piece');
  assert.equal(id.animeLikely, true);
});

test('Metadata Rescue recognizes bare absolute One Piece episode in S23', () => {
  const filename = '[Erai-raws] One Piece - 1156 [1080p CR WEB-DL AVC AAC][58B0C8A2].mkv';
  const id = buildIdentityCandidates({
    relative_path: `OP2/One Piece/S23/${filename}`,
    filename
  });
  assert.equal(id.kind, 'tv');
  assert.equal(id.season, 23);
  assert.equal(id.episode, 1156);
  assert.equal(normalizeTitle(id.query), 'one piece');
  assert.equal(id.animeLikely, true);
});

test('confidence strongly favors exact title and matching year', () => {
  const exact = matchConfidence('Dune Part Two', 'Dune: Part Two', 2024, 2024);
  const wrong = matchConfidence('Dune Part Two', 'Dune', 2024, 1984);
  assert.ok(exact >= 90);
  assert.ok(wrong < exact);
  assert.ok(wrong < rescueProviderConfig().autoThreshold);
});

test('accent and punctuation normalization is stable', () => {
  assert.equal(normalizeTitle("L'amica geniale"), 'l amica geniale');
  assert.equal(normalizeTitle('Pokémon: Horizons'), 'pokemon horizons');
});
