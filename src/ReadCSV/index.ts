import fs from 'fs';
import csvtojson from 'csvtojson';
let soccerMatches: any[] = [];

function manUnitedWins() {
  enum MatchResult {
    HomeWin = 'H',
    AwayWin = 'A',
    Draw = 'D'
  }
  let manUnitedWins = 0;

  for (let match of soccerMatches) {
    if (match.homeTeam === 'Man United' && match.winner === MatchResult.HomeWin) {
      manUnitedWins++;
    } else if (match.awayTeam === 'Man United' && match.winner === MatchResult.AwayWin) {
      manUnitedWins++;
    }
  }
  return `Man United won ${manUnitedWins} games`;
}

const readCsv = async () => {
  console.log('readCsv');
  soccerMatches = await csvtojson({
    noheader: true,
    headers: ['data', 'homeTeam', 'awayTeam', 'homeScore', 'awayScore', 'winner', 'mvp']
  })
    .fromFile('./src/ReadCSV/football.csv');
  //console.log(soccerMatches);
  console.log(manUnitedWins());
};

export default readCsv;
