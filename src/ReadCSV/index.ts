import csvtojson from 'csvtojson';
import Debug from 'debug';

const debug = Debug('web-jam-back:ReadCSV');
interface IReadCSV {
  date: string | Date;
  homeTeam: string;
  winner: string;
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
    enum MatchResult {
      HomeWin = 'H',
      AwayWin = 'A',
      Draw = 'D'
    }
    let manWins = 0;

    this.soccerMatches.map((match) => {
      if (match.homeTeam === 'Man United' && match.winner === MatchResult.HomeWin) {
        manWins += 1;
      } else if (match.awayTeam === 'Man United' && match.winner === MatchResult.AwayWin) {
        manWins += 1;
      }
      return match;
    });
    debug(this.soccerMatches);
    return `Man United won ${manWins} games`;
  }

  convertDates():void{
    this.soccerMatches = this.soccerMatches.map((m) => {
      const match = m;
      if (typeof match.date !== 'string') return match;
      const tmpDate:string = match.date;
      const tmpDateArr = tmpDate.split('/');
      match.date = new Date(Number(tmpDateArr[2]), Number(tmpDate[1]) - 1, Number(tmpDate[0]));
      return match;
    });
  }

  convertScores():void{
    this.soccerMatches = this.soccerMatches.map((m) => {
      const match = m;
      match.homeScore = Number(match.homeScore);
      match.awayScore = Number(match.awayScore);
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
    } catch (e) { return `${e.message}`; }
    this.convertDates();
    this.convertScores();
    return this.manUnitedWins();
  }
}
export default ReadCSV;

