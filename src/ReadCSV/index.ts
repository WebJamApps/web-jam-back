import csvtojson from 'csvtojson';

enum MatchResult {
  HomeWin = 'H',
  AwayWin = 'A',
  Draw = 'D',
}
interface IReadCSV {
  date: string | Date;
  homeTeam: string;
  winner: MatchResult;
  awayTeam: string;
  homeScore: number;
  awayScore: number;
}

class ReadCSV {
  csvtojson: typeof csvtojson;

  soccerMatches: IReadCSV[];

  constructor() {
    this.csvtojson = csvtojson;
    this.soccerMatches = [];
  }

  manUnitedWins(): string {
    let manWins = 0;

    this.soccerMatches.map((match) => {
      if (match.homeTeam === 'Man United' && match.winner === MatchResult.HomeWin) {
        manWins += 1;
      } else if (match.awayTeam === 'Man United' && match.winner === MatchResult.AwayWin) {
        manWins += 1;
      }
      return match;
    });
    return `Man United won ${manWins} games`;
  }

  convertData():void {
    this.soccerMatches = this.soccerMatches.map((m) => {
      const match = m;
      match.homeScore = Number(match.homeScore);
      match.awayScore = Number(match.awayScore);
      if (typeof match.date !== 'string') return match;
      const tmpDateArr = match.date.split('/');
      match.date = new Date(Number(tmpDateArr[2]), Number(tmpDateArr[1]) - 1, Number(tmpDateArr[0]));
      return match;
    });
  }

  async run(): Promise<string> {
    try {
      this.soccerMatches = await this.csvtojson({
        noheader: true,
        headers: ['date', 'homeTeam', 'awayTeam', 'homeScore', 'awayScore', 'winner', 'mvp'],
      })
        .fromFile('./src/ReadCSV/football.csv');
    } catch (e) { const eMessage = (e as Error).message; return `${eMessage}`; }
    this.convertData();
    return this.manUnitedWins();
  }
}
export default ReadCSV;
