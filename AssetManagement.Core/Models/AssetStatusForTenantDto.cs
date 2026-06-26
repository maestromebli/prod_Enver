using AssetManagement.Core.Enums;

using AssetManagement.Core.Enums;

namespace AssetManagement.Core.Models;

/// <summary>
/// Стан одного активу для відображення в UI.
/// </summary>
public class AssetStatusForTenantDto
{
    public Guid AssetId { get; set; }
    public string AssetType { get; set; } = string.Empty;
    public string AssetName { get; set; } = string.Empty;
    public AssetStatus Status { get; set; }
    public DateTime LastUpdated { get; set; }
    public string UpdatedBy { get; set; } = string.Empty;
}
