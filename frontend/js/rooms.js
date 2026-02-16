// Rooms helper module
// Additional room utilities

function getRoomColor(index) {
  const colors = [
    '#6c5ce7', '#00b894', '#e17055', '#0984e3',
    '#e84393', '#00cec9', '#fdcb6e', '#fab1a0',
    '#a29bfe', '#55efc4', '#ff7675', '#74b9ff'
  ];
  return colors[index % colors.length];
}