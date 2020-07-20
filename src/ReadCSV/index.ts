import csvtojson from 'csvtojson';

class ReadCSV {
  csvtojson: typeof csvtojson;

  soccerMatches: any[];
  
  constructor() {
    this.csvtojson = csvtojson;
    this.soccerMatches = [];
  }

  manUnitedWins(): string { 
    enum MatchResult {
      HomeWin = 'H',
      AwayWin = 'A',
      Draw = 'D'
    }
    let manWins = 0;

    // eslint-disable-next-line no-restricted-syntax
    for (const match of this.soccerMatches) {
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

  async run(): Promise<string> {
    try {
      this.soccerMatches = await this.csvtojson({
        noheader: true,
        headers: ['data', 'homeTeam', 'awayTeam', 'homeScore', 'awayScore', 'winner', 'mvp'],
      })
        .fromFile('./src/ReadCSV/football.csv');
    } catch (e) { return `${e.message}`; }
    return this.manUnitedWins();
  }
}
export default ReadCSV;

