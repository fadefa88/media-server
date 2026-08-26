import test from 'node:test';
import assert from 'node:assert/strict';
import { parseMediaIdentity, resolveTmdbSeasonEpisode } from '../src/tmdb.mjs';

test('movie filename becomes a clean TMDB query', () => {
  const x = parseMediaIdentity({
    relative_path: 'Cartoni/La bella addormentata nel bosco - Sleeping Beauty (1959) 1080p H264 Ac3 5.1 Ita Eng Sub Ita Eng-MIRCrew.mkv',
    filename: 'La bella addormentata nel bosco - Sleeping Beauty (1959) 1080p H264 Ac3 5.1 Ita Eng Sub Ita Eng-MIRCrew.mkv'
  });
  assert.equal(x.kind, 'movie');
  assert.equal(x.year, 1959);
  assert.match(x.query.toLowerCase(), /bella addormentata/);
  assert.doesNotMatch(x.query.toLowerCase(), /1080p|h264|mirc/);
});

test('SxxExx path is detected as television', () => {
  const x = parseMediaIdentity({
    relative_path: 'Serie/Severance/S02/Severance.S02E03.2160p.WEB-DL.mkv',
    filename: 'Severance.S02E03.2160p.WEB-DL.mkv'
  });
  assert.equal(x.kind, 'tv');
  assert.equal(x.query, 'Severance');
  assert.equal(x.season, 2);
  assert.equal(x.episode, 3);
});

test('season folder plus E1047 numbering is detected', () => {
  const x = parseMediaIdentity({
    relative_path: 'OP2/One Piece/S21/One.Piece.E1047.1080p.mp4',
    filename: 'One.Piece.E1047.1080p.mp4'
  });
  assert.equal(x.kind, 'tv');
  assert.equal(x.query, 'One Piece');
  assert.equal(x.season, 21);
  assert.equal(x.episode, 1047);
});

test('OP2 root folder is aliased to One Piece for TMDB lookup', () => {
  const x = parseMediaIdentity({
    relative_path: 'OP2/S23/One.Piece.S23E01.1080p.WEB-DL.mkv',
    filename: 'One.Piece.S23E01.1080p.WEB-DL.mkv'
  });
  assert.equal(x.kind, 'tv');
  assert.equal(x.query, 'One Piece');
  assert.equal(x.season, 23);
  assert.equal(x.episode, 1);
});

test('season folder plus bare absolute anime episode is detected', () => {
  const filename = '[Erai-raws] One Piece - 1156 [1080p CR WEB-DL AVC AAC][58B0C8A2].mkv';
  const x = parseMediaIdentity({
    relative_path: `OP2/One Piece/S23/${filename}`,
    filename
  });
  assert.equal(x.kind, 'tv');
  assert.equal(x.query, 'One Piece');
  assert.equal(x.season, 23);
  assert.equal(x.episode, 1156);
});

test('SubsPlease bare absolute anime episode is detected', () => {
  const filename = '[SubsPlease] One Piece - 1175 (1080p) [004956F1].mkv';
  const x = parseMediaIdentity({
    relative_path: `OP2/One Piece/S23/${filename}`,
    filename
  });
  assert.equal(x.kind, 'tv');
  assert.equal(x.query, 'One Piece');
  assert.equal(x.season, 23);
  assert.equal(x.episode, 1175);
});

test('TMDB season fallback maps relative episode index to absolute numbering', () => {
  const episodes = [
    { episode_number: 1156, name: 'Elbaph 1' },
    { episode_number: 1157, name: 'Elbaph 2' },
    { episode_number: 1158, name: 'Elbaph 3' }
  ];
  assert.equal(resolveTmdbSeasonEpisode(episodes, 1)?.episode_number, 1156);
  assert.equal(resolveTmdbSeasonEpisode(episodes, 2)?.episode_number, 1157);
  assert.equal(resolveTmdbSeasonEpisode(episodes, 1157)?.episode_number, 1157);
  assert.equal(resolveTmdbSeasonEpisode(episodes, 4), null);
});
