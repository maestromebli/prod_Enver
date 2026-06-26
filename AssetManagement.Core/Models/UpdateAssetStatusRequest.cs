using AssetManagement.Core.Enums;

namespace AssetManagement.Core.Models;

public class UpdateAssetStatusRequest
{
    public Guid AssetId { get; set; }
    public AssetStatus NewStatus { get; set; }
    public string UpdatedBy { get; set; } = string.Empty;
}
