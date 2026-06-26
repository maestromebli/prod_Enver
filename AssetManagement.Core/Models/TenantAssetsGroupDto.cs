namespace AssetManagement.Core.Models;

/// <summary>
/// Група активів одного tenant для списку на головній сторінці.
/// </summary>
public class TenantAssetsGroupDto
{
    public TenantSummary Tenant { get; set; } = null!;
    public List<AssetStatusForTenantDto> Assets { get; set; } = new();
}
