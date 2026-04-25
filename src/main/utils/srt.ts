export function secondsToSrtTime(seconds: number): string {
  const totalMs = Math.max(0, Math.floor(seconds * 1000));
  const ms = totalMs % 1000;
  const totalSec = Math.floor(totalMs / 1000);
  const sec = totalSec % 60;
  const totalMin = Math.floor(totalSec / 60);
  const min = totalMin % 60;
  const hour = Math.floor(totalMin / 60);

  return `${hour.toString().padStart(2, '0')}:${min.toString().padStart(2, '0')}:${sec
    .toString()
    .padStart(2, '0')},${ms.toString().padStart(3, '0')}`;
}
