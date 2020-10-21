import csvtojson from 'csvtojson';
// import Debug from 'debug';

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
export default ReadCSV;

