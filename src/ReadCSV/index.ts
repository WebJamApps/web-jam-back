// import fs from 'fs';
import csvtojson from 'csvtojson';

let soccerMatches: any[] = [];

function manUnitedWins() {
  enum MatchResult {
    HomeWin = 'H',
    AwayWin = 'A',
    Draw = 'D'
  }
  let manWins = 0;

  // eslint-disable-next-line no-restricted-syntax
  for (const match of soccerMatches) {
    if (match.homeTeam === 'Man United' && match.winner === MatchResult.HomeWin) {
      // eslint-disable-next-line no-plusplus
      manWins++;
    } else if (match.awayTeam === 'Man United' && match.winner === MatchResult.AwayWin) {
      // eslint-disable-next-line no-plusplus
      manWins++;
    }
  }
  return `Man United won ${manWins} games`;
}

const readCsv = async (): Promise<string> => {
  try {
    soccerMatches = await csvtojson({
      noheader: true,
      headers: ['data', 'homeTeam', 'awayTeam', 'homeScore', 'awayScore', 'winner', 'mvp'],
    })
      .fromFile('./src/ReadCSV/football.csv');
  } catch (e) { return `${e.message}`; }
  return manUnitedWins();
};

export default readCsv;
